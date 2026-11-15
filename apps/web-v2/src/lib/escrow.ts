/**
 * Wallet transactions against VoucherEscrowV2 (contracts/src/VoucherEscrowV2.sol), hand-encoded.
 * In V2 each person sends their own transactions; the server only checks the chain afterwards.
 *
 *   spender  approve + deposit, release, cancel, dispute
 *   buyer    accept (with the spender's signed Ready/Assign permit), markDelivered
 *
 * Two ids: `escrowRef` goes into `deposit`; `escrowId` (derived on-chain from depositor + ref) is used everywhere else.
 * Both come from the server. The encoders are pure so node tests can import them.
 */
import { ARC, ARC_USDC, assertOnArc, assertUsdc, switchToArc, usdcAllowance } from "./arc.ts";
import { ST, decodeGetEscrow, encodeGetEscrow, type EscrowRecord } from "./onchain.ts";
import { httpRpc, prepareTx, refusesFeeFields, toHex, weiToUsdcBaseUnits, quantity, type Rpc } from "./txgas.ts";

export const SELECTORS = {
  approve: "0x095ea7b3", // approve(address,uint256)
  deposit: "0xd67bd797", // deposit(bytes32,address,uint256,uint64,uint256)
  accept: "0x5a4e6b04", // accept(bytes32,uint64,bytes)
  markDelivered: "0x4c69bf78", // markDelivered(bytes32,bytes32)
  release: "0x67d42a8b", // release(bytes32)
  cancel: "0xc4d252f5", // cancel(bytes32)
  dispute: "0x82cbf88b", // dispute(bytes32,bytes32)
} as const;

export const ZERO_BYTES32 = `0x${"0".repeat(64)}`;

const U64_MAX = (1n << 64n) - 1n;

function word(n: bigint) {
  if (n < 0n) throw new Error("Negative number in calldata");
  const h = n.toString(16);
  if (h.length > 64) throw new Error("Number too large for calldata");
  return h.padStart(64, "0");
}
function addressWord(a: string) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a)) throw new Error("Not an address");
  return a.slice(2).toLowerCase().padStart(64, "0");
}
function bytes32(v: string, what: string) {
  const h = v.replace(/^0x/i, "");
  if (!/^[0-9a-fA-F]{64}$/.test(h)) throw new Error(`${what} is not a 32-byte hash`);
  return h.toLowerCase();
}

export function encodeApprove(spender: string, amount: bigint) {
  return SELECTORS.approve + addressWord(spender) + word(amount);
}

/** deposit(ref, token, amount, ttl, maxTotal). The contract pulls `amount + fee` and reverts if that exceeds `maxTotal`. */
export function encodeDeposit(ref: string, token: string, amount: bigint, ttlSeconds: bigint | number, maxTotal: bigint) {
  const ttl = BigInt(ttlSeconds);
  if (ttl <= 0n || ttl > U64_MAX) throw new Error("Order lifetime is out of range");
  return SELECTORS.deposit + bytes32(ref, "Escrow reference") + addressWord(token) + word(amount) + word(ttl) + word(maxTotal);
}

/** accept(id, validUntil, signature). `signature` is dynamic: the head holds its offset (0x60), then length, then padded data. */
export function encodeAccept(escrowId: string, validUntil: bigint | number, signature: string) {
  const until = BigInt(validUntil);
  if (until <= 0n || until > U64_MAX) throw new Error("Permit expiry is out of range");
  const sig = signature.replace(/^0x/i, "").toLowerCase();
  if (!sig || sig.length % 2 !== 0 || !/^[0-9a-f]+$/.test(sig)) throw new Error("The Ready signature is not valid hex");
  const padded = sig.padEnd(Math.ceil(sig.length / 64) * 64, "0");
  return SELECTORS.accept + bytes32(escrowId, "Escrow id") + word(until) + word(0x60n) + word(BigInt(sig.length / 2)) + padded;
}

export const encodeMarkDelivered = (escrowId: string, evidence: string = ZERO_BYTES32) => SELECTORS.markDelivered + bytes32(escrowId, "Escrow id") + bytes32(evidence, "Evidence");
export const encodeRelease = (escrowId: string) => SELECTORS.release + bytes32(escrowId, "Escrow id");
export const encodeCancel = (escrowId: string) => SELECTORS.cancel + bytes32(escrowId, "Escrow id");
export const encodeDispute = (escrowId: string, reason: string = ZERO_BYTES32) => SELECTORS.dispute + bytes32(escrowId, "Escrow id") + bytes32(reason, "Reason");

/* ---------------------------------------------------------------- sending */

/** The transaction was sent but hasn't confirmed in the time we waited. It may still go through. */
export class PendingTxError extends Error {
  hash: string;
  constructor(hash: string) {
    super("The transaction is still pending. Check your wallet. When it confirms, press the button again: the app reads the chain first, so you won't pay twice.");
    this.hash = hash;
  }
}

async function waitForReceipt(request: Rpc, hash: string, what: string) {
  for (let i = 0; i < 60; i++) {
    const receipt = (await request({ method: "eth_getTransactionReceipt", params: [hash] }).catch(() => null)) as { status?: string } | null;
    if (receipt) {
      if (receipt.status === "0x0") throw new Error(`The ${what} transaction failed on-chain. Nothing changed.`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw new PendingTxError(hash);
}

/**
 * Second node for gas and fee reads when the wallet's own node refuses them: the configured Arc RPC, over fetch.
 * `undefined` means "not built yet"; tests set it to null (or a stub) with `setTxFallbackRpc`.
 */
let fallbackRpc: Rpc | null | undefined;
export function setTxFallbackRpc(rpc: Rpc | null) {
  fallbackRpc = rpc;
}
function fallback(): Rpc | null {
  if (fallbackRpc === undefined) fallbackRpc = typeof fetch === "function" ? httpRpc(ARC.rpc) : null;
  return fallbackRpc;
}

/**
 * The one place a transaction is sent. Before the wallet is asked for anything:
 *  - the wallet must be on the configured Arc network;
 *  - `eth_estimateGas` must succeed (a revert becomes a readable error and nothing is sent);
 *  - the wallet must hold `spends` USDC plus the most this transaction can cost in gas (Arc charges gas in USDC).
 * The transaction then carries its own gas limit (estimate x 1.2) and EIP-1559 fees, so a wallet whose estimator
 * doesn't cover Arc can still show a fee and enable Confirm.
 */
async function send(request: Rpc, tx: { from: string; to: string; data: string }, what: string, opts: { onHash?: (hash: string) => void; spends?: bigint } = {}) {
  await assertOnArc(request);
  // The amount alone first: "not enough USDC" is clearer than the revert the estimate would report for it.
  if (opts.spends) await assertUsdc(request, tx.from, opts.spends, 0n);
  const prepared = await prepareTx(request, tx, what, fallback());
  await assertUsdc(request, tx.from, opts.spends ?? 0n, prepared.maxCostWei === null ? undefined : weiToUsdcBaseUnits(prepared.maxCostWei));
  const base = { ...tx, value: "0x0" };
  let hash: unknown;
  try {
    hash = await request({ method: "eth_sendTransaction", params: [{ ...base, ...prepared.fields }] });
  } catch (error) {
    // A wallet that doesn't take EIP-1559 fields for this network refuses before showing anything. Try once more
    // with a plain gas price, which every wallet understands.
    if (!prepared.fields.maxFeePerGas || !refusesFeeFields(error)) throw error;
    const legacy = { ...base, ...(prepared.fields.gas ? { gas: prepared.fields.gas } : {}), gasPrice: toHex(quantity(prepared.fields.maxFeePerGas) ?? 0n) };
    hash = await request({ method: "eth_sendTransaction", params: [legacy] });
  }
  if (typeof hash !== "string" || !/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Your wallet didn't return a transaction hash.");
  opts.onHash?.(hash);
  await waitForReceipt(request, hash, what);
  return hash;
}

/** The escrow record, read through the connected wallet's own node. */
export async function readEscrowVia(request: Rpc, contract: string, escrowId: string): Promise<EscrowRecord> {
  const out = await request({ method: "eth_call", params: [{ to: contract, data: encodeGetEscrow(escrowId) }, "latest"] });
  return decodeGetEscrow(typeof out === "string" ? out : "");
}

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

/* ---------------------------------------------------------------- deposit */

export type LockTerms = {
  from: string;
  /** VoucherEscrowV2 address. */
  escrow: string;
  /** `request.escrowRef`: the reference passed to deposit. */
  escrowRef: string;
  /** `request.escrowId`: where the deposit will live on-chain. */
  escrowId: string;
  token: string;
  /** What the buyer receives, in base units. */
  amount: bigint;
  /** amount + fee: what the wallet approves and what leaves it. */
  total: bigint;
  ttlSeconds: number;
  wallet?: string;
  onStep?: (s: "switch" | "approve" | "deposit") => void;
  /** Fires as soon as the deposit is sent, before it confirms, so the caller can keep the hash. */
  onDepositHash?: (hash: string) => void;
};

/** Approve USDC for exactly the total, then deposit. Returns the deposit transaction hash once it has confirmed. */
export async function lockUsdc(request: Rpc, t: LockTerms): Promise<string> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(t.escrow)) throw new Error("Escrow contract address is missing.");
  if (!same(t.token, ARC_USDC)) throw new Error(`The server asked for a token other than USDC on ${ARC.name} (${t.token}). Stopping; no funds have moved.`);
  if (t.amount <= 0n || t.total < t.amount) throw new Error("The lock amount from the server is not valid.");
  t.onStep?.("switch");
  await switchToArc(request, t.wallet);

  // Each order gets a fresh id from the server, so a record here means something is off. Never deposit on top of it.
  const existing = await readEscrowVia(request, t.escrow, t.escrowId).catch(() => null);
  if (existing && existing.status !== ST.None) throw new Error("The escrow already has a record under this order's id. Stopping; nothing was sent.");

  // USDC lets an allowance be raised without resetting it first, and one left over from an earlier attempt is reused.
  const allowed = await usdcAllowance(request, t.from, t.escrow).catch(() => 0n);
  if (allowed < t.total) {
    t.onStep?.("approve");
    await send(request, { from: t.from, to: ARC_USDC, data: encodeApprove(t.escrow, t.total) }, "approval", { spends: t.total });
  }
  t.onStep?.("deposit");
  return send(request, { from: t.from, to: t.escrow, data: encodeDeposit(t.escrowRef, t.token, t.amount, t.ttlSeconds, t.total) }, "deposit", { onHash: t.onDepositHash, spends: t.total });
}

/* ------------------------------------------------- the other escrow steps */

export type EscrowStep = "accept" | "markDelivered" | "release" | "cancel" | "dispute";

export type StepArgs = {
  from: string;
  escrow: string;
  escrowId: string;
  wallet?: string;
  /** accept only: the spender's stored Ready permit. */
  permit?: { validUntil: number; epoch?: number; signature: string } | null;
  /** markDelivered: evidence hash. dispute: reason hash. Zero when omitted. */
  hash?: string;
};

export type StepPlan = { do: "send" } | { do: "skip" } | { do: "stop"; why: string };

/**
 * What a step should do given the escrow's state right now: send the transaction, skip it because the chain already
 * shows the result (so a retry never pays or reverts twice), or stop with a reason the person can act on.
 */
export function planStep(step: EscrowStep, e: EscrowRecord, from: string, nowSec: number, permit?: StepArgs["permit"]): StepPlan {
  const stop = (why: string): StepPlan => ({ do: "stop", why });
  const st = e.status;
  if (st === ST.None) return step === "cancel" ? { do: "skip" } : stop("The escrow contract has no deposit for this order.");
  switch (step) {
    case "accept":
      if (same(e.fulfiller, from) && st !== ST.Refunded) return { do: "skip" };
      if (st !== ST.Funded) return stop("This order is no longer open on-chain.");
      if (e.fulfiller) return stop("Another wallet is already bound to this order on-chain.");
      if (same(e.depositor, from)) return stop("The wallet that locked the USDC can't also be the buyer.");
      if (nowSec >= e.openUntil) return stop("This order has expired on-chain, so it can't be accepted any more.");
      if (!permit?.signature) return stop("The spender hasn't pressed Ready yet. Wait for it, and don't buy the voucher before then.");
      // The escrow bumps its epoch when a buyer steps away, which voids every permit signed before that.
      if (typeof permit.epoch === "number" && permit.epoch !== e.epoch) return stop("The spender's Ready was signed for an earlier round of this order and no longer works. Ask them to press Ready again, and don't buy the voucher until this step confirms.");
      if (permit.validUntil <= nowSec) return stop("The spender's Ready permit has expired. Ask them to press Ready again, and don't buy the voucher until this step confirms.");
      return { do: "send" };
    case "markDelivered":
      if (st === ST.Delivered || st === ST.Disputed || st === ST.Released || st === ST.Resolved) return { do: "skip" };
      if (st !== ST.Funded) return stop("This order was refunded on-chain, so the voucher can't be delivered for it.");
      if (!same(e.fulfiller, from)) return stop("This wallet is not the buyer bound to the order on-chain. Confirm the order from your wallet first.");
      if (nowSec >= e.deadline) return stop("The delivery deadline has passed on-chain, so this voucher can't be delivered for the order.");
      return { do: "send" };
    case "release":
      if (st === ST.Released) return { do: "skip" };
      if (st === ST.Refunded || st === ST.Resolved) return stop("This escrow has already been settled on-chain, so there is nothing to release.");
      if (!same(e.depositor, from)) return stop("Only the wallet that locked the USDC can release it.");
      if (!e.fulfiller) return stop("No buyer is bound to this order on-chain, so there is nobody to pay.");
      return { do: "send" };
    case "cancel":
      if (st === ST.Refunded) return { do: "skip" };
      if (st !== ST.Funded) return stop("This order can't be cancelled any more: the voucher was delivered or the escrow has settled.");
      if (!same(e.depositor, from)) return stop("Only the wallet that locked the USDC can cancel the order.");
      if (e.fulfiller) return stop("A buyer is already bound to this order on-chain, so it can't be cancelled. If they don't deliver in time, the USDC can be refunded after the deadline.");
      return { do: "send" };
    case "dispute":
      if (st === ST.Disputed) return { do: "skip" };
      if (st === ST.Funded) return stop("The buyer hasn't marked the voucher delivered on-chain yet, so there is nothing to dispute.");
      if (st !== ST.Delivered) return stop("This escrow has already been settled on-chain, so it can't be disputed.");
      if (!same(e.depositor, from)) return stop("Only the spender can open a dispute.");
      return { do: "send" };
  }
}

const STEP_NAME: Record<EscrowStep, string> = { accept: "accept", markDelivered: "delivery", release: "release", cancel: "cancel", dispute: "dispute" };

/**
 * Run one escrow step from the connected wallet. Reads the escrow first, so pressing the button again after a
 * failure or a closed tab is safe. Returns the transaction hash, or null when the chain already showed the result.
 */
export async function escrowStep(request: Rpc, step: EscrowStep, a: StepArgs): Promise<string | null> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.escrow)) throw new Error("Escrow contract address is missing.");
  if (!/^0x[0-9a-fA-F]{40}$/.test(a.from)) throw new Error("Connect your wallet first.");
  await switchToArc(request, a.wallet);
  let record: EscrowRecord;
  try {
    record = await readEscrowVia(request, a.escrow, a.escrowId);
  } catch (e) {
    throw new Error(`Couldn't read the escrow on ${ARC.name} (${e instanceof Error ? e.message : "no answer"}). Nothing was sent. Try again.`);
  }
  const plan = planStep(step, record, a.from, Math.floor(Date.now() / 1000), a.permit);
  if (plan.do === "stop") throw new Error(plan.why);
  if (plan.do === "skip") return null;
  const data =
    step === "accept"
      ? encodeAccept(a.escrowId, a.permit!.validUntil, a.permit!.signature)
      : step === "markDelivered"
        ? encodeMarkDelivered(a.escrowId, a.hash)
        : step === "release"
          ? encodeRelease(a.escrowId)
          : step === "cancel"
            ? encodeCancel(a.escrowId)
            : encodeDispute(a.escrowId, a.hash);
  // Opening a dispute locks the order's dispute stake inside the same transaction, so the escrow needs an allowance for it.
  // The stake comes back unless the dispute is decided against the spender.
  const stake = step === "dispute" ? record.bond : 0n;
  if (stake > 0n) {
    const allowed = await usdcAllowance(request, a.from, a.escrow).catch(() => 0n);
    if (allowed < stake) await send(request, { from: a.from, to: ARC_USDC, data: encodeApprove(a.escrow, stake) }, "stake approval", { spends: stake });
  }
  return send(request, { from: a.from, to: a.escrow, data }, STEP_NAME[step], { spends: stake });
}

/** 32-byte hash accepted by POST /requests/:id/fund when a development server runs the mock escrow. Never used in a production build. */
export const mockTxHash = () => `0x${"ab".repeat(32)}`;

/* ------------------------------------------------------- terms of a lock */

/** Decimal USDC string ("5.37", "0.053700") to 6-decimal base units. Throws on anything that isn't a plain amount. */
export function usdcBaseUnits(text: string): bigint {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(text.trim());
  if (!m) throw new Error("Not a USDC amount");
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? "").padEnd(6, "0") || "0");
}

/** Base units as a plain decimal with at least two places: 5370000 -> "5.37", 53700 -> "0.0537". */
export function usdcExact(base: bigint) {
  const whole = base / 1_000_000n;
  const frac = (base % 1_000_000n).toString().padStart(6, "0").replace(/0{1,4}$/, "");
  return `${whole}.${frac}`;
}

/** What the screen showed and what the server says may differ by rounding only: one cent. */
export const TERMS_TOLERANCE = 10_000n;

export type Terms = { amount: bigint; fee: bigint; total: bigint };

/**
 * The server's terms for a new order, checked against what the person was shown before any wallet prompt.
 * Throws a message for them when the buyer's amount isn't what was asked, the numbers don't add up, or the total
 * differs from the screen by more than rounding.
 */
export function lockTerms(shown: { receives: string; total: string }, server: { amountUsdcBaseUnits?: string; feeUsdcBaseUnits?: string; totalUsdcBaseUnits?: string }): Terms {
  const read = (v: string | undefined) => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : null);
  const amount = read(server.amountUsdcBaseUnits);
  const fee = read(server.feeUsdcBaseUnits);
  const total = read(server.totalUsdcBaseUnits);
  if (amount === null || fee === null || total === null) throw new Error("The server didn't say what fee and total it will lock, so the app stopped before asking your wallet. Nothing was locked.");
  if (amount <= 0n || amount + fee !== total) throw new Error("The server's amount, fee and total don't add up, so the app stopped before asking your wallet. Nothing was locked.");
  if (amount !== usdcBaseUnits(shown.receives)) {
    throw new Error(`The server would pay the buyer ${usdcExact(amount)} USDC, not the ${shown.receives} USDC you reviewed. Nothing was locked.`);
  }
  const shownTotal = usdcBaseUnits(shown.total);
  const diff = total > shownTotal ? total - shownTotal : shownTotal - total;
  if (diff > TERMS_TOLERANCE) {
    throw new Error(`The server's total is ${usdcExact(total)} USDC (fee ${usdcExact(fee)}), but you reviewed ${shown.total} USDC. The fee may have changed. Nothing was locked; review the order again.`);
  }
  return { amount, fee, total };
}
