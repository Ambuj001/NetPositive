import type { DisputeRequest } from "./dispute";

/**
 * What the dispute page shows for one order. Plain logic only (no React, no network) so it can be tested.
 * The rules mirror the backend: either person can dispute while the code is waiting for review; the crypto spender only
 * inside the review window.
 */
export type Role = "spender" | "buyer";

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function roleIn(r: Pick<DisputeRequest, "crypto_spender" | "crypto_buyer">, viewer?: string | null): Role | null {
  if (same(viewer, r.crypto_spender)) return "spender";
  if (same(viewer, r.crypto_buyer)) return "buyer";
  return null;
}

export const disputerOf = (r: DisputeRequest) => r.dispute?.by ?? r.disputedBy ?? null;
export const hasDispute = (r: DisputeRequest) => r.status === "disputed" || !!r.dispute || !!r.disputedBy;

export type Screen = { kind: "raise" } | { kind: "view" } | { kind: "none"; why: string };

export function screenFor(r: DisputeRequest, viewer: string | null | undefined, now: number): Screen {
  const role = roleIn(r, viewer);
  if (!role) return { kind: "none", why: "Only the two people in this trade can open or read its dispute." };
  if (hasDispute(r)) return { kind: "view" };
  if (r.status === "code_submitted") {
    if (role === "spender" && r.reviewDeadline && Date.parse(r.reviewDeadline) < now) {
      return { kind: "none", why: "The review window has closed, so the USDC is being released to the buyer." };
    }
    return { kind: "raise" };
  }
  if (r.status === "released" || r.status === "refunded") return { kind: "none", why: "This trade is finished and nothing was disputed." };
  return { kind: "none", why: "A dispute can be raised once the voucher code has been submitted." };
}

/** One line on where the stake stands. */
export function stakeLine(r: DisputeRequest, viewer?: string | null): string {
  const bond = r.dispute?.bond;
  if (!bond || bond.status === "none" || !bond.status) return "No stake was needed.";
  const mine = same(viewer, disputerOf(r));
  if (bond.status === "held") return mine ? "Your stake is locked in escrow until the team decides." : "The other person's stake is locked in escrow.";
  if (bond.status === "returned") return mine ? "Your stake was returned to you." : "The stake was returned to the person who raised the dispute.";
  if (bond.status === "forfeited") return mine ? "Your stake went to the other person." : "You received the stake.";
  return `Stake: ${bond.status}`;
}

/** What the team decided, from this person's point of view. Null while it is still open. */
export function outcomeLine(r: DisputeRequest, viewer?: string | null): { good: boolean; text: string } | null {
  const verdict = r.resolution?.verdict;
  if (verdict !== "disputer_right" && verdict !== "disputer_wrong") return null;
  const disputer = same(viewer, disputerOf(r));
  const right = verdict === "disputer_right";
  if (disputer) {
    return right
      ? { good: true, text: "The team ruled in your favour. Your stake was returned and the trade settled your way." }
      : { good: false, text: "The team ruled against you. Your stake went to the other person, the trade settled against you and your account is banned." };
  }
  return right
    ? { good: false, text: "The team ruled for the other person. The trade settled their way and you got a strike." }
    : { good: true, text: "The team ruled in your favour. The trade settled your way and you received the other person's stake." };
}
