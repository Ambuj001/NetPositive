/**
 * Read an order's escrow straight from the VoucherEscrowV2 contract on Arc, without going through the NetPositive
 * server. This is how a buyer can check that the USDC really is locked before spending money on a voucher.
 * Pure functions (no React, no env) so node tests can import them.
 */
export const ESCROW_STATUS = ["None", "Funded", "Delivered", "Disputed", "Released", "Refunded", "Resolved"] as const;
export const ST = { None: 0, Funded: 1, Delivered: 2, Disputed: 3, Released: 4, Refunded: 5, Resolved: 6 } as const;

const ZERO_ADDRESS = `0x${"0".repeat(40)}`;

/** One escrow record, as `getEscrow(bytes32)` returns it. Times are unix seconds. */
export type EscrowRecord = {
  depositor: string;
  /** An unassigned escrow can be refunded from this time. */
  openUntil: number;
  epoch: number;
  /** The buyer bound on-chain, or null while nobody is. */
  fulfiller: string | null;
  /** End of the current phase: open, fulfil, review or dispute. */
  deadline: number;
  status: number;
  token: string;
  reviewWindow: number;
  fulfillWindow: number;
  /** Paid to the fulfiller on release. */
  amount: bigint;
  /** Locked on top of `amount`. */
  fee: bigint;
  /** Stake the spender locks on top to open a dispute. Held only while disputed. */
  bond: bigint;
};
export type OnchainEscrow = EscrowRecord & { block: number };

const SEL_GET_ESCROW = "0xf023b811"; // getEscrow(bytes32) -> Escrow (11 static words)

function id32(escrowId: string) {
  const id = escrowId.replace(/^0x/i, "").toLowerCase();
  if (!/^[0-9a-f]{64}$/.test(id)) throw new Error("Escrow id is not a 32-byte hash");
  return id;
}

export function encodeGetEscrow(escrowId: string) {
  return SEL_GET_ESCROW + id32(escrowId);
}

/** Decode the 11 words of `getEscrow`: depositor, openUntil, epoch, fulfiller, deadline, status, token, reviewWindow, fulfillWindow, amount, fee. */
export function decodeGetEscrow(hex: string): EscrowRecord {
  const h = typeof hex === "string" ? hex.replace(/^0x/i, "") : "";
  if (h.length < 64 * 12) throw new Error("The contract returned no escrow data (wrong address, or not this contract)");
  const word = (i: number) => h.slice(i * 64, i * 64 + 64);
  const addr = (i: number) => `0x${word(i).slice(24)}`.toLowerCase();
  const big = (i: number) => BigInt(`0x${word(i)}`);
  const num = (i: number) => Number(big(i));
  const fulfiller = addr(3);
  return {
    depositor: addr(0),
    openUntil: num(1),
    epoch: num(2),
    fulfiller: fulfiller === ZERO_ADDRESS ? null : fulfiller,
    deadline: num(4),
    status: num(5),
    token: addr(6),
    reviewWindow: num(7),
    fulfillWindow: num(8),
    amount: big(9),
    fee: big(10),
    bond: big(11),
  };
}

type Fetch = (url: string, init: { method: string; headers: Record<string, string>; body: string; signal?: AbortSignal }) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

/** One JSON-RPC batch to a public Arc node: the escrow record and the block it was read at. */
export async function readEscrow(rpcUrl: string, contract: string, escrowId: string, fetchFn: Fetch = fetch as unknown as Fetch): Promise<OnchainEscrow> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(contract)) throw new Error("No escrow contract address");
  const data = encodeGetEscrow(escrowId);
  const res = await fetchFn(rpcUrl, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify([
      { jsonrpc: "2.0", id: 1, method: "eth_call", params: [{ to: contract, data }, "latest"] },
      { jsonrpc: "2.0", id: 2, method: "eth_blockNumber", params: [] },
    ]),
    signal: typeof AbortSignal !== "undefined" && "timeout" in AbortSignal ? AbortSignal.timeout(12_000) : undefined,
  });
  if (!res.ok) throw new Error(`The Arc node answered HTTP ${res.status}`);
  const out = (await res.json()) as { id: number; result?: string; error?: { message?: string } }[];
  const by = (id: number) => {
    const r = Array.isArray(out) ? out.find((x) => x.id === id) : undefined;
    if (!r || r.error || typeof r.result !== "string") throw new Error(r?.error?.message || "The Arc node gave no answer");
    return r.result;
  };
  return { ...decodeGetEscrow(by(1)), block: Number(BigInt(by(2))) };
}

export type Verdict = { ok: boolean; tone: "good" | "warn" | "bad"; title: string; detail: string };

type ServerView = { status: string; crypto_spender: string; crypto_buyer?: string | null; amountUsdcBaseUnits: string };

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const shortAddr = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`;

/** "in 12 min", "in 3 h", or "has passed": how far a phase deadline is from now. */
export function untilText(deadlineSec: number, nowMs: number) {
  const s = Math.round(deadlineSec - nowMs / 1000);
  if (s <= 0) return "has passed";
  if (s < 3600) return `in ${Math.max(1, Math.round(s / 60))} min`;
  if (s < 48 * 3600) return `in ${Math.round(s / 3600)} h`;
  return `in ${Math.round(s / 86400)} days`;
}

/**
 * Compare what the chain says with what the server says about an order. The chain wins.
 * `amount` on-chain is what the buyer is paid; it must equal the order's `amountUsdcBaseUnits`. The fee sits on top.
 */
export function judgeEscrow(server: ServerView, chain: OnchainEscrow, nowMs: number = Date.now()): Verdict {
  const usdc = (n: bigint) => `${(Number(n) / 1e6).toFixed(2)} USDC`;
  const said = `"${server.status.replaceAll("_", " ")}"`;
  const st = chain.status;

  if (st === ST.None) {
    return server.status === "pending_funding" || server.status === "cancelled"
      ? { ok: true, tone: "warn", title: "Not locked yet", detail: "The contract has no deposit for this order. Don't buy a voucher for it until this shows Funded." }
      : { ok: false, tone: "bad", title: "No deposit on-chain", detail: `The server says ${said}, but the contract has no deposit under this escrow id. Don't proceed.` };
  }
  if (st === ST.Released) return { ok: true, tone: "good", title: "Released on-chain", detail: `The contract paid ${usdc(chain.amount)} to the buyer${chain.fulfiller ? ` ${shortAddr(chain.fulfiller)}` : ""} (read at block ${chain.block}).` };
  if (st === ST.Refunded) return { ok: true, tone: "warn", title: "Refunded on-chain", detail: "The contract returned this deposit to the spender. There is nothing left to earn on this order." };
  if (st === ST.Resolved) return { ok: true, tone: "warn", title: "Dispute resolved on-chain", detail: "The arbiter split this escrow between the buyer and the spender. Nothing is locked any more." };

  // Still holding funds: Funded, Delivered or Disputed.
  let expected: bigint;
  try {
    expected = BigInt(server.amountUsdcBaseUnits);
  } catch {
    return { ok: false, tone: "bad", title: "Amount can't be checked", detail: "The order has no readable USDC amount to compare with the contract. Don't proceed." };
  }
  if (chain.amount !== expected) return { ok: false, tone: "bad", title: "Amount doesn't match", detail: `The contract will pay the buyer ${usdc(chain.amount)}, but the order says ${usdc(expected)}. Don't proceed.` };
  if (!same(chain.depositor, server.crypto_spender)) return { ok: false, tone: "bad", title: "Different depositor", detail: `The deposit came from ${chain.depositor}, not the spender on this order. Don't proceed.` };
  if (chain.fulfiller && server.crypto_buyer && !same(chain.fulfiller, server.crypto_buyer)) {
    return { ok: false, tone: "bad", title: "Different buyer on-chain", detail: `The contract will pay ${chain.fulfiller}, not the buyer on this order. Don't proceed.` };
  }
  const live = ["open", "accepted", "code_submitted", "disputed", "releasing", "refunding"].includes(server.status);
  const state = ESCROW_STATUS[st] ?? `state ${st}`;
  if (!live) return { ok: false, tone: "warn", title: `Still ${state.toLowerCase()} on-chain`, detail: `The server says ${said}, but the contract still holds ${usdc(chain.amount)}. It may be catching up; refresh in a minute.` };

  const held = `${usdc(chain.amount)} for the buyer plus a ${usdc(chain.fee)} fee`;
  const at = `Read from the contract at block ${chain.block}`;
  if (st === ST.Disputed) {
    return { ok: true, tone: "warn", title: "Disputed on-chain", detail: `${at}: ${held} is frozen until the arbiter rules. If nobody rules, it returns to the spender ${untilText(chain.deadline, nowMs)}.` };
  }
  if (st === ST.Delivered) {
    const pays = chain.fulfiller ? shortAddr(chain.fulfiller) : "the buyer";
    return { ok: true, tone: "good", title: `${usdc(chain.amount)} locked · delivered`, detail: `${at}: the buyer marked the voucher delivered. The review window ends ${untilText(chain.deadline, nowMs)}; after that anyone can pay ${pays} unless the spender disputes.` };
  }
  // Funded.
  if (chain.fulfiller) {
    const due = chain.deadline * 1000 > nowMs ? `is ${untilText(chain.deadline, nowMs)}` : "has passed, so the spender can be refunded";
    return { ok: true, tone: "good", title: `${usdc(chain.amount)} locked on Arc`, detail: `${at}: ${held}, deposited by the spender and bound to buyer ${shortAddr(chain.fulfiller)}. The delivery deadline ${due}.` };
  }
  if (server.status === "accepted") {
    return { ok: true, tone: "warn", title: `${usdc(chain.amount)} locked · no buyer bound yet`, detail: `${at}: the deposit is there, but no buyer is bound on-chain. The buyer must confirm the order from their wallet before buying the voucher.` };
  }
  return { ok: true, tone: "good", title: `${usdc(chain.amount)} locked on Arc`, detail: `${at}: ${held}, deposited by the spender. Open for a buyer; the order expires ${untilText(chain.deadline, nowMs)}. Only the escrow's rules can move it.` };
}
