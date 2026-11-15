/**
 * What the escrow charges and allows right now, as the server reads it from the contract (GET /escrow/terms):
 * fee, order limits, the launch cap, the dispute stake and whether new deposits are paused.
 * Pure functions (no React, no env) so node tests can import them. The hook lives in `useTerms.ts`.
 */

/** Used only while the terms are loading or the server can't be reached. Anything priced with it is an estimate. */
export const DEFAULT_FEE_BPS = 100;

export type EscrowTerms = {
  version: number;
  mode: "chain" | "mock";
  chainId: number;
  /** Null when the server runs the mock escrow. */
  contract: string | null;
  token: string;
  feeBps: number;
  disputeBond: bigint;
  min: bigint;
  max: bigint;
  cap: bigint;
  locked: bigint;
  orderTtlSeconds: number;
  reviewWindowSeconds: number;
  fulfillWindowSeconds: number;
  paused: boolean;
};

const units = (v: unknown): bigint | null => (typeof v === "string" && /^\d+$/.test(v) ? BigInt(v) : typeof v === "number" && Number.isSafeInteger(v) && v >= 0 ? BigInt(v) : null);
const seconds = (v: unknown) => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);

/** The server's answer, checked. Null when it isn't a usable set of terms (the caller then falls back and says so). */
export function parseTerms(raw: unknown): EscrowTerms | null {
  const r = raw as Record<string, unknown> | null;
  if (!r || typeof r !== "object") return null;
  const feeBps = typeof r.feeBps === "number" ? r.feeBps : typeof r.feeBps === "string" && /^\d+$/.test(r.feeBps) ? Number(r.feeBps) : NaN;
  const min = units(r.minBaseUnits);
  const max = units(r.maxBaseUnits);
  const cap = units(r.capBaseUnits);
  const locked = units(r.lockedBaseUnits);
  // The contract never allows more than 5% (MAX_FEE_BPS); a larger number means this isn't the answer we expect.
  if (!Number.isInteger(feeBps) || feeBps < 0 || feeBps > 1000) return null;
  if (min === null || max === null || cap === null || locked === null) return null;
  return {
    version: typeof r.version === "number" ? r.version : 0,
    mode: r.mode === "mock" ? "mock" : "chain",
    chainId: typeof r.chainId === "number" ? r.chainId : Number(r.chainId) || 0,
    contract: typeof r.contract === "string" && /^0x[0-9a-fA-F]{40}$/.test(r.contract) ? r.contract.toLowerCase() : null,
    token: typeof r.token === "string" ? r.token.toLowerCase() : "",
    feeBps,
    disputeBond: units(r.disputeBondBaseUnits) ?? 0n,
    min,
    max,
    cap,
    locked,
    orderTtlSeconds: seconds(r.orderTtlSeconds),
    reviewWindowSeconds: seconds(r.reviewWindowSeconds),
    fulfillWindowSeconds: seconds(r.fulfillWindowSeconds),
    paused: r.paused === true,
  };
}

/** The contract's own sum: fee = amount x feeBps / 10000, rounded down. */
export const feeOn = (amount: bigint, feeBps: number) => (amount * BigInt(feeBps)) / 10_000n;

/** "1%", "0.5%", "1.25%". */
export function feePercent(feeBps: number) {
  return `${(feeBps / 100).toFixed(2).replace(/\.?0+$/, "")}%`;
}

/** Base units as a short amount for messages: 5000000 -> "5", 5370000 -> "5.37", 1 -> "0.000001". */
export function usdcShort(base: bigint) {
  const whole = base / 1_000_000n;
  const frac = (base % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  const grouped = whole.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return frac ? `${grouped}.${frac.length === 1 ? `${frac}0` : frac}` : grouped;
}

/** A number of USDC (as shown on screen) in 6-decimal base units. */
export const toBaseUnits = (usdc: number) => (Number.isFinite(usdc) && usdc > 0 ? BigInt(Math.round(usdc * 1_000_000)) : 0n);

export type AmountCheck = { ok: true } | { ok: false; reason: "paused" | "below_min" | "above_max" | "over_cap"; text: string };

/**
 * Can an order paying the buyer `amount` (base units) be locked under these terms? Checked before any wallet prompt,
 * so nobody signs an approval for a deposit the contract would refuse.
 */
export function checkAmount(terms: EscrowTerms, amount: bigint): AmountCheck {
  if (terms.paused) return { ok: false, reason: "paused", text: "New orders are paused right now. Orders already in escrow are not affected: they can still be completed, cancelled or refunded." };
  if (amount <= 0n) return { ok: true };
  if (amount < terms.min) return { ok: false, reason: "below_min", text: `The smallest order is ${usdcShort(terms.min)} USDC to the buyer. This one is ${usdcShort(amount)} USDC.` };
  if (amount > terms.max) return { ok: false, reason: "above_max", text: `The largest order is ${usdcShort(terms.max)} USDC to the buyer. This one is ${usdcShort(amount)} USDC.` };
  const room = terms.cap > terms.locked ? terms.cap - terms.locked : 0n;
  if (amount + feeOn(amount, terms.feeBps) > room) {
    return {
      ok: false,
      reason: "over_cap",
      text: room > 0n
        ? `The escrow is near its launch cap: only ${usdcShort(room)} USDC can still be locked across all orders, and this order needs ${usdcShort(amount + feeOn(amount, terms.feeBps))}. Try a smaller order, or try again when open orders settle.`
        : "The escrow has reached its launch cap, so new orders are paused until open orders settle.",
    };
  }
  return { ok: true };
}

/** One line for the order form: "Orders from 1 to 500 USDC." */
export function limitsLine(terms: EscrowTerms) {
  return `Orders from ${usdcShort(terms.min)} to ${usdcShort(terms.max)} USDC.`;
}

/* ------------------------------------------------------------ server errors */

type ErrorLike = { status?: number; code?: unknown; details?: unknown };

/**
 * Text for server answers that need more than the server's own sentence: a rate outside the allowed band, and
 * "too many requests". Null for anything else, so callers keep their own wording.
 */
export function serverErrorText(e: unknown): string | null {
  const err = (e ?? {}) as ErrorLike;
  const d = (err.details ?? {}) as Record<string, unknown>;
  if (err.code === "rate_out_of_range") {
    const implied = Number(d.impliedRate);
    const market = Number(d.marketRate);
    const max = Number(d.maxDeviationPct);
    if (![implied, market, max].every((n) => Number.isFinite(n) && n > 0)) return "This order's rate is too far from the market rate. Change the rate and try again. Nothing was locked.";
    const lo = market * (1 - max / 100);
    const hi = market * (1 + max / 100);
    return `This order prices 1 USDC at ₹${implied.toFixed(2)}, but the market rate is about ₹${market.toFixed(2)}. Orders must be within ${max}% of it (₹${lo.toFixed(2)} to ₹${hi.toFixed(2)}). Change the rate and try again. Nothing was locked.`;
  }
  if (err.code === "rate_limited" || err.status === 429) {
    const wait = Number(d.retryAfterSeconds);
    return Number.isFinite(wait) && wait > 0 ? `Too many requests. Try again in ${Math.ceil(wait)} second${Math.ceil(wait) === 1 ? "" : "s"}.` : "Too many requests. Wait a moment and try again.";
  }
  return null;
}

/** Seconds from a Retry-After header (a number of seconds, or an HTTP date), or null. */
export function retryAfterSeconds(header: string | null | undefined, nowMs = Date.now()): number | null {
  if (!header) return null;
  const n = Number(header.trim());
  if (Number.isFinite(n) && n >= 0) return Math.ceil(n);
  const at = Date.parse(header);
  return Number.isFinite(at) ? Math.max(0, Math.ceil((at - nowMs) / 1000)) : null;
}
