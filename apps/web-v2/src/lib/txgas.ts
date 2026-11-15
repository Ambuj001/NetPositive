/**
 * Gas limit and EIP-1559 fees for a transaction, worked out by the app instead of left to the wallet.
 *
 * Some wallets' own estimators don't cover Arc ("Network fee estimation unsuccessful", Confirm disabled). So before
 * anything is sent the app calls `eth_estimateGas` itself, which also proves the call would not revert, and reads
 * the base fee and tip. Each read goes to the wallet's node first and to the configured Arc RPC if that refuses.
 * Pure helpers plus two small RPC wrappers; no React and no env, so node tests can import it.
 */
import { keccak_256 } from "@noble/hashes/sha3";

export type Rpc = (args: { method: string; params?: unknown[] | object }) => Promise<unknown>;

export type TxCall = { from: string; to: string; data: string; value?: string };

export type GasFields = { gas?: string; maxFeePerGas?: string; maxPriorityFeePerGas?: string };

export type Prepared = {
  /** Fields to spread into the `eth_sendTransaction` params. Empty when no node would answer. */
  fields: GasFields;
  /** The most this transaction can cost in the gas coin's smallest unit (gas limit × max fee), or null when unknown. */
  maxCostWei: bigint | null;
};

export const GWEI = 1_000_000_000n;
export const DEFAULT_TIP_WEI = GWEI;

/** The call would revert (or cannot be paid for), so nothing was sent. `message` is written for the person. */
export class TxWouldFailError extends Error {
  reason: string;
  constructor(what: string, reason: string) {
    super(`The ${what} transaction would fail${reason ? `: ${reason}` : ""}. Nothing was sent.`);
    this.reason = reason;
  }
}

export const toHex = (n: bigint) => `0x${n.toString(16)}`;

/** A JSON-RPC quantity ("0x5208") as a bigint, or null for anything else. */
export function quantity(v: unknown): bigint | null {
  if (typeof v === "string" && /^0x[0-9a-fA-F]+$/.test(v)) return BigInt(v);
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  return null;
}

/** Gas limit: the estimate plus 20%, rounded up. */
export const gasWithMargin = (estimate: bigint) => (estimate * 12n + 9n) / 10n;

/** EIP-1559 fees: the max fee leaves room for the base fee to double before the transaction lands. */
export function feesFrom(baseFee: bigint, tip: bigint) {
  return { maxPriorityFeePerGas: tip, maxFeePerGas: 2n * baseFee + tip };
}

/** Arc's gas coin is USDC at 18 decimals; the token is the same USDC at 6. Rounds up so a check never under-asks. */
export const weiToUsdcBaseUnits = (wei: bigint) => (wei + 999_999_999_999n) / 1_000_000_000_000n;

/* ---------------------------------------------------------- revert reasons */

/** VoucherEscrowV2's custom errors (contracts/src/VoucherEscrowV2.sol) and OpenZeppelin's, in plain words. */
const KNOWN_ERRORS: Record<string, string> = {
  "ZeroAddress()": "an address is missing",
  "ZeroAmount()": "the amount is zero",
  "TokenNotAllowed()": "the escrow does not accept this token",
  "AmountOutOfRange()": "the amount is outside the escrow's order limits",
  "CapExceeded()": "the escrow has reached its launch cap, so it is not taking new deposits right now",
  "TotalExceedsMax()": "the fee changed and the total is now more than you approved",
  "IdAlreadyUsed()": "this order id already has a deposit",
  "WrongStatus()": "the order is not in the right state on-chain for this step",
  "NotDepositor()": "this wallet is not the one that locked the USDC",
  "NotFulfiller()": "this wallet is not the USDC buyer bound to the order",
  "AlreadyAssigned()": "another USDC buyer is already bound to this order",
  "NotAssigned()": "no USDC buyer is bound to this order yet",
  "InvalidFulfiller()": "this wallet cannot be the USDC buyer of this order",
  "TooEarly()": "it is too early for this step",
  "TooLate()": "the deadline for this step has passed",
  "SignatureExpired()": "the voucher buyer's Ready signature has expired",
  "BadSignature()": "the voucher buyer's Ready signature does not match this order (it may name a different USDC buyer or an earlier round)",
  "ShortTransfer()": "the token transferred less than expected",
  "EnforcedPause()": "the escrow is paused for new deposits",
  "ReentrancyGuardReentrantCall()": "the contract refused a re-entrant call",
  "ERC20InsufficientBalance(address,uint256,uint256)": "this wallet does not hold enough USDC",
  "ERC20InsufficientAllowance(address,uint256,uint256)": "the USDC approval is too small",
  "SafeERC20FailedOperation(address)": "the USDC transfer failed (not enough USDC, or the approval is too small)",
};

let selectors: Map<string, string> | null = null;
function knownError(selector: string) {
  if (!selectors) {
    selectors = new Map();
    for (const [sig, text] of Object.entries(KNOWN_ERRORS)) {
      const hash = keccak_256(new TextEncoder().encode(sig));
      selectors.set(Array.from(hash.subarray(0, 4), (b) => b.toString(16).padStart(2, "0")).join(""), text);
    }
  }
  return selectors.get(selector.toLowerCase());
}

/** Revert data (`Error(string)`, `Panic(uint256)` or a custom error) as a short reason, or "" when there is none. */
export function decodeRevert(data: unknown): string {
  if (typeof data !== "string" || !/^0x[0-9a-fA-F]{8,}$/.test(data)) return "";
  const sel = data.slice(2, 10).toLowerCase();
  const body = data.slice(10);
  if (sel === "08c379a0" && body.length >= 128) {
    try {
      const len = Number(BigInt(`0x${body.slice(64, 128)}`));
      const hex = body.slice(128, 128 + len * 2);
      const bytes = new Uint8Array(hex.length / 2);
      for (let i = 0; i < bytes.length; i++) bytes[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      return new TextDecoder().decode(bytes).replace(/[^\x20-\x7e]/g, "").slice(0, 160);
    } catch {
      return "";
    }
  }
  if (sel === "4e487b71") return "the contract hit an internal check (panic)";
  return knownError(sel) ?? `the contract refused it (error 0x${sel})`;
}

type RpcError = { code?: number; message?: string; data?: unknown; error?: unknown; cause?: unknown; info?: unknown };

function revertData(e: RpcError | undefined, depth = 0): string {
  if (!e || typeof e !== "object" || depth > 4) return "";
  if (typeof e.data === "string" && /^0x[0-9a-fA-F]{8,}$/.test(e.data)) return e.data;
  for (const inner of [e.data, e.error, e.cause, e.info]) {
    const hit = revertData(inner as RpcError, depth + 1);
    if (hit) return hit;
  }
  return "";
}

/**
 * What an `eth_estimateGas` failure means.
 *   revert       the call itself would fail: do not send
 *   funds        the account cannot pay for it: do not send
 *   unavailable  the node would not answer (unknown method, network trouble): ask another node
 */
export function classifyEstimateError(error: unknown): { kind: "revert" | "funds" | "unavailable"; reason: string } {
  const e = (error ?? {}) as RpcError;
  const text = typeof e.message === "string" ? e.message : "";
  const data = revertData(e);
  if (/insufficient funds|insufficient balance for transfer|gas required exceeds allowance/i.test(text)) {
    return { kind: "funds", reason: "this wallet does not have enough USDC to pay the network fee" };
  }
  if (data || e.code === 3 || /execution reverted|always failing transaction|\brevert(ed)?\b|invalid opcode|out of gas/i.test(text)) {
    const fromText = /execution reverted:?\s*(.+)$/i.exec(text)?.[1]?.trim() ?? "";
    // Nodes echo the raw data in the message when the error is a custom one; that is not a reason anyone can read.
    const readable = fromText && !/^0x[0-9a-fA-F]*$/.test(fromText) ? fromText.slice(0, 160) : "";
    return { kind: "revert", reason: decodeRevert(data) || readable || "the escrow contract refused it" };
  }
  return { kind: "unavailable", reason: text };
}

/* ------------------------------------------------------------- RPC access */

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** A JSON-RPC caller over HTTP with the same shape as a wallet's `request`. Errors keep the node's code and data. */
export function httpRpc(url: string, fetchFn: Fetch = fetch as unknown as Fetch): Rpc {
  let id = 0;
  return async ({ method, params }) => {
    const res = await fetchFn(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
      signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(12_000) : undefined,
    });
    if (!res.ok) throw new Error(`The node answered HTTP ${res.status}`);
    const out = (await res.json()) as { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
    if (out?.error) throw Object.assign(new Error(out.error.message || "The node returned an error"), { code: out.error.code, data: out.error.data });
    return out?.result;
  };
}

/** Ask each node in turn until one gives a usable answer; null when none does. */
async function read<T>(nodes: Rpc[], method: string, params: unknown[], pick: (v: unknown) => T | null): Promise<T | null> {
  for (const node of nodes) {
    try {
      const got = pick(await node({ method, params }));
      if (got !== null) return got;
    } catch {
      /* try the next node */
    }
  }
  return null;
}

/**
 * Estimate gas, then read fees. Throws `TxWouldFailError` when a node says the call would revert or cannot be paid
 * for. When no node answers at all the fields come back empty and the wallet is left to fill them in.
 */
export async function prepareTx(wallet: Rpc, tx: TxCall, what: string, fallback?: Rpc | null): Promise<Prepared> {
  const nodes = fallback ? [wallet, fallback] : [wallet];
  const call = { from: tx.from, to: tx.to, data: tx.data, value: tx.value ?? "0x0" };

  let estimate: bigint | null = null;
  for (const node of nodes) {
    try {
      estimate = quantity(await node({ method: "eth_estimateGas", params: [call] }));
      if (estimate !== null && estimate > 0n) break;
      estimate = null;
    } catch (error) {
      const verdict = classifyEstimateError(error);
      if (verdict.kind !== "unavailable") throw new TxWouldFailError(what, verdict.reason);
    }
  }

  const baseFee =
    (await read(nodes, "eth_getBlockByNumber", ["latest", false], (b) => quantity((b as { baseFeePerGas?: unknown } | null)?.baseFeePerGas))) ??
    (await read(nodes, "eth_gasPrice", [], quantity));
  const tip = (await read(nodes, "eth_maxPriorityFeePerGas", [], quantity)) ?? DEFAULT_TIP_WEI;

  const fields: GasFields = {};
  let maxCostWei: bigint | null = null;
  if (estimate !== null) fields.gas = toHex(gasWithMargin(estimate));
  if (baseFee !== null && baseFee > 0n) {
    const fees = feesFrom(baseFee, tip);
    fields.maxFeePerGas = toHex(fees.maxFeePerGas);
    fields.maxPriorityFeePerGas = toHex(fees.maxPriorityFeePerGas);
    if (estimate !== null) maxCostWei = gasWithMargin(estimate) * fees.maxFeePerGas;
  }
  return { fields, maxCostWei };
}

/** True when a wallet rejected the transaction because of the fee fields themselves (not the person declining). */
export function refusesFeeFields(error: unknown) {
  const e = (error ?? {}) as RpcError;
  if (e.code === 4001) return false;
  const text = typeof e.message === "string" ? e.message : "";
  return /eip-?1559|maxFeePerGas|maxPriorityFeePerGas|invalid transaction params|unsupported transaction type|transaction type not supported/i.test(text);
}
