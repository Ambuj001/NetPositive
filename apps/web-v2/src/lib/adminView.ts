/**
 * Words and numbers for the /admin page. Pure functions (no React, no env) so node tests can import them.
 */
import { CHAINS } from "./chain.ts";
import { usdcShort } from "./terms.ts";

/** Order statuses the server counts, in the order the page lists them. Mirrors `ReqStatus` in api.ts. */
export const LIVE_STATUSES = ["pending_funding", "open", "accepted", "code_submitted", "disputed", "releasing", "refunding"] as const;
export const FINISHED_STATUSES = ["released", "refunded", "cancelled"] as const;
export type OrderStatus = (typeof LIVE_STATUSES)[number] | (typeof FINISHED_STATUSES)[number];

/** Counts per status, plus totals for orders still in progress and orders that are over. Missing or bad counts are 0. */
export function orderTotals(orders: Partial<Record<string, unknown>> | null | undefined) {
  const n = (s: string) => {
    const v = orders?.[s];
    return typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
  };
  const live = LIVE_STATUSES.reduce((sum, s) => sum + n(s), 0);
  const finished = FINISHED_STATUSES.reduce((sum, s) => sum + n(s), 0);
  return {
    live,
    finished,
    total: live + finished,
    count: n,
  };
}

/** How much of the launch cap is locked: a percentage for the bar (0–100, one decimal) and a line of text. */
export function capUsage(locked: bigint, cap: bigint): { pct: number; text: string; full: boolean } {
  if (cap <= 0n) return { pct: locked > 0n ? 100 : 0, text: `${usdcShort(locked)} USDC locked, no cap set`, full: locked > 0n };
  const tenths = Number((locked * 1000n) / cap); // per mille, rounded down
  const pct = Math.min(100, tenths / 10);
  return { pct, text: `${usdcShort(locked)} of ${usdcShort(cap)} USDC locked (${pct}%)`, full: locked >= cap };
}

export type SwitchConfirm = { title: string; body: string; cta: string };

/** What the confirmation step says before the World ID requirement is switched to `next`. */
export function switchConfirm(next: boolean): SwitchConfirm {
  return next
    ? {
        title: "Switch the World ID requirement on?",
        body: "From now on, posting, funding, accepting and delivering an order need a World ID bound to the wallet. Wallets that have not verified are asked to verify with World ID the next time they do one of these. Orders already in progress are not cancelled, but their next step will ask for World ID.",
        cta: "Yes, require World ID",
      }
    : {
        title: "Switch the World ID requirement off?",
        body: "From now on, any signed-in wallet can post, fund, accept and deliver orders without World ID, and one person can use many wallets. A ban then only stops the wallet that was banned. World IDs already linked stay linked.",
        cta: "Yes, switch it off",
      };
}

export const WORLD_ID_STATE_LINE = {
  on: "On: every trader must prove they are one person with World ID.",
  off: "Off: any wallet can trade; one person can use many wallets.",
} as const;

/** "0x1234…abcd" */
export const shortAddress = (a: string) => (a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a);

/** Who changed the setting last and when, or that it still has the server's default. */
export function changedLine(settings: { updatedBy: string | null; updatedAt: string | null }, timeZone?: string): string {
  if (!settings.updatedBy && !settings.updatedAt) return "Not changed here yet: the server's default (WORLD_ID_REQUIRED) applies.";
  const at = settings.updatedAt ? Date.parse(settings.updatedAt) : NaN;
  const when = Number.isFinite(at)
    ? new Date(at).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", ...(timeZone ? { timeZone } : {}) })
    : null;
  const who = settings.updatedBy ? shortAddress(settings.updatedBy) : "an administrator";
  return `Last changed by ${who}${when ? ` on ${when}` : ""}.`;
}

/** The explorer for a chain id the server reports, or null when it is not an Arc network this app knows. */
export function explorerFor(chainId: number): string | null {
  const c = Object.values(CHAINS).find((x) => x.id === chainId);
  return c ? c.explorer : null;
}

/** "Arc (5042)", "Arc Testnet (5042002)", "chain 31337". */
export function networkName(chainId: number): string {
  const c = Object.values(CHAINS).find((x) => x.id === chainId);
  return c ? `${c.name} (${c.id})` : `chain ${chainId}`;
}

/** The server's RATE_MAX_DEVIATION_PCT in words. 0 (or missing) means orders are not checked against the market rate. */
export function rateCheckLine(pct: unknown): string {
  return typeof pct === "number" && Number.isFinite(pct) && pct > 0 ? `Within ${pct}% of the market rate` : "Off: rates are not checked against the market";
}
