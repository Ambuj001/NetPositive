/**
 * The escrow's numbers as words, for pages that explain the product (docs, terms, landing copy).
 * Live values come from `useTerms` (GET /escrow/terms). While they are loading, or when the server can't be reached,
 * the launch values below are used instead and `live` is false, so the page can say they are launch values.
 * Display only: nothing here is used to price or send an order. Pure functions, so node tests can import them.
 */
import { DEFAULT_FEE_BPS, feeOn, feePercent, usdcShort, type EscrowTerms } from "./terms.ts";

/** What the contract was deployed with (contracts/deployments/arc-mainnet.json). Fallback for display only. */
export const LAUNCH_TERMS = {
  feeBps: DEFAULT_FEE_BPS,
  min: 1_000_000n,
  max: 250_000_000n,
  cap: 5_000_000_000n,
  disputeBond: 1_000_000n,
  reviewWindowSeconds: 86_400,
  fulfillWindowSeconds: 7_200,
} as const;

/** Fixed in the contract's code; the owner cannot change these. */
export const CONTRACT_CONSTANTS = { maxFeePercent: "5%", disputeTimeoutDays: 30 } as const;

/** The live deployment (contracts/deployments/arc-mainnet.json). */
export const LIVE_DEPLOYMENT = {
  network: "Arc mainnet",
  chainId: 5042,
  contract: "0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2",
  usdc: "0x3600000000000000000000000000000000000000",
  explorer: "https://explorer.arc.io",
  rpc: "https://rpc.mainnet.arc.io",
  deployedOn: "14 November 2026",
} as const;

/** 86400 -> "24 hours", 7200 -> "2 hours", 5400 -> "90 minutes", 259200 -> "3 days", 60 -> "1 minute". */
export function durationText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  const unit = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  if (seconds % 86_400 === 0 && seconds >= 2 * 86_400) return unit(seconds / 86_400, "day");
  if (seconds % 3_600 === 0) return unit(seconds / 3_600, "hour");
  if (seconds >= 60) return unit(Math.round(seconds / 60), "minute");
  return unit(Math.round(seconds), "second");
}

export type DisplayTerms = {
  /** True when the values were read from the server just now; false when they are the launch values. */
  live: boolean;
  /** The server runs a simulated escrow (development only), so the values are its test settings. */
  mock: boolean;
  /** "1%" */
  fee: string;
  /** "1", "250", "5,000": USDC amounts without the unit. */
  min: string;
  max: string;
  cap: string;
  /** USDC locked across all open orders right now. Null unless live. */
  locked: string | null;
  /** "1"; "0" means disputes need no stake. */
  stake: string;
  hasStake: boolean;
  /** "24 hours", "2 hours" */
  review: string;
  fulfil: string;
  /** How long an open order waits for a buyer, e.g. "3 days". Null unless live (it is a server setting). */
  orderOpen: string | null;
  /** New deposits are paused. Always false unless live. */
  paused: boolean;
  /** The worked example: for 100 USDC to the buyer, the fee and the total the spender locks. */
  exampleFee: string;
  exampleTotal: string;
};

export function displayTerms(terms: EscrowTerms | null): DisplayTerms {
  const t = terms ?? null;
  const feeBps = t ? t.feeBps : LAUNCH_TERMS.feeBps;
  const stake = t ? t.disputeBond : LAUNCH_TERMS.disputeBond;
  const hundred = 100_000_000n;
  const fee = feeOn(hundred, feeBps);
  return {
    live: !!t,
    mock: !!t && t.mode === "mock",
    fee: feePercent(feeBps),
    min: usdcShort(t ? t.min : LAUNCH_TERMS.min),
    max: usdcShort(t ? t.max : LAUNCH_TERMS.max),
    cap: usdcShort(t ? t.cap : LAUNCH_TERMS.cap),
    locked: t ? usdcShort(t.locked) : null,
    stake: usdcShort(stake),
    hasStake: stake > 0n,
    review: durationText(t && t.reviewWindowSeconds > 0 ? t.reviewWindowSeconds : LAUNCH_TERMS.reviewWindowSeconds),
    fulfil: durationText(t && t.fulfillWindowSeconds > 0 ? t.fulfillWindowSeconds : LAUNCH_TERMS.fulfillWindowSeconds),
    orderOpen: t && t.orderTtlSeconds > 0 ? durationText(t.orderTtlSeconds) : null,
    paused: !!t && t.paused,
    exampleFee: usdcShort(fee),
    exampleTotal: usdcShort(hundred + fee),
  };
}
