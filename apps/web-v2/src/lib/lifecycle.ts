/**
 * Pure logic for the order tracker (`/track?id=…`): who is the viewer, what has happened so far, what happens next.
 * No React, no network. Everything is derived from the request document the API returns (`GET /requests/:id`).
 *
 * Roles (on screen, then backend names in brackets). On screen the names are always "voucher buyer" and "USDC buyer":
 *   spender  voucher buyer [crypto_spender]  locked USDC in escrow and receives the gift voucher
 *   buyer    USDC buyer    [crypto_buyer]    buys the voucher with their own card, hands over the code, receives USDC
 *   observer                                 anyone else, or nobody connected
 * What to do next (headline, actions, deadline) lives in `orderView.ts`.
 */
import type { ApiRequest, ReqStatus } from "./api";

export type Role = "spender" | "buyer" | "observer";
export type Tone = "mint" | "amber" | "iris" | "rose" | "mute";
export type StageState = "done" | "current" | "upcoming" | "skipped";
export type StageKey = "created" | "funded" | "accepted" | "ready" | "code" | "dispute" | "outcome";

export type Stage = {
  key: StageKey;
  title: string;
  /** One sentence, written for the viewer's role. */
  detail: string;
  state: StageState;
  tone: Tone;
  at: string | null;
  /** Wallet that did this step, when known. */
  actor: string | null;
  tx: string | null;
  /** Extra label/value lines (dispute reason, ruling, …). */
  facts: { label: string; value: string }[];
  /** A running deadline for this step. */
  deadline: { label: string; at: string } | null;
};


export const sameAddr = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();

export function roleOf(r: Pick<ApiRequest, "crypto_spender" | "crypto_buyer">, address: string | null | undefined): Role {
  if (sameAddr(address, r.crypto_spender)) return "spender";
  if (sameAddr(address, r.crypto_buyer)) return "buyer";
  return "observer";
}

export const isSettled = (s: ReqStatus) => s === "released" || s === "refunded" || s === "cancelled";

/** Wallet as a short label, or "you" when it is the viewer. */
export function nameOf(addr: string | null | undefined, role: Role, party: "spender" | "buyer"): string {
  if (!addr) return party === "buyer" ? "a USDC buyer" : "the voucher buyer";
  if (role === party) return "you";
  return party === "buyer" ? "the USDC buyer" : "the voucher buyer";
}

const REACHED_FUNDING = new Set<ReqStatus>(["open", "accepted", "code_submitted", "disputed", "releasing", "released", "refunding", "refunded"]);
const CODE_STATES = new Set<ReqStatus>(["code_submitted", "disputed", "releasing", "released"]);

/** What has really happened, from the document's timestamps first and its status second. */
export function facts(r: ApiRequest) {
  const funded = !!r.fundedAt || !!r.escrowTxHash || REACHED_FUNDING.has(r.status);
  const accepted = !!r.acceptedAt || !!r.crypto_buyer;
  const code = !!r.codeSubmittedAt || CODE_STATES.has(r.status);
  const disputed = !!(r.disputeReason || r.disputedAt || r.resolution) || r.status === "disputed";
  return { funded, accepted, code, disputed, settled: isSettled(r.status) };
}

const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
/** What the buyer is paid. */
const usdc = (r: ApiRequest) => fmt(Number(r.amountUsdc) || 0);
/** What the spender locked: the buyer's amount plus the fee. Orders from before escrow V2 have no total, so the amount stands in. */
const lockedUsdc = (r: ApiRequest) => (r.totalUsdcBaseUnits && /^\d+$/.test(r.totalUsdcBaseUnits) ? fmt(Number(r.totalUsdcBaseUnits) / 1e6) : usdc(r));
const wasFunded = (r: ApiRequest) => !!r.fundedAt || !!r.escrowTxHash;


export function buildStages(r: ApiRequest, role: Role, brandName: string = r.brand, now: number = Date.now()): Stage[] {
  const f = facts(r);
  const s = r.status;
  const amt = `${usdc(r)} USDC`;
  const locked = `${lockedUsdc(r)} USDC`;
  const stages: Stage[] = [];
  const mk = (p: Partial<Stage> & Pick<Stage, "key" | "title" | "detail">): Stage => ({
    state: "upcoming",
    tone: "mint",
    at: null,
    actor: null,
    tx: null,
    facts: [],
    deadline: null,
    ...p,
  });

  stages.push(
    mk({
      key: "created",
      title: "Order created",
      detail: role === "spender" ? "You asked for this voucher." : `The voucher buyer asked for a ₹${r.amountInr.toLocaleString("en-IN")} ${brandName} voucher.`,
      at: r.createdAt,
      actor: r.crypto_spender,
      state: "done",
    }),
  );

  stages.push(
    mk({
      key: "funded",
      title: "USDC locked in escrow",
      detail: role === "spender" ? `You deposited ${locked} from your wallet. It stays locked until the trade settles.` : role === "buyer" ? `${amt} for you is held by the escrow contract, so the funds really exist.` : `${amt} for the USDC buyer is held by the escrow contract, so the funds really exist.`,
      at: r.fundedAt ?? null,
      actor: r.crypto_spender,
      tx: r.escrowTxHash,
      state: f.funded ? "done" : "upcoming",
    }),
  );

  stages.push(
    mk({
      key: "accepted",
      title: role === "buyer" ? "You accepted" : "USDC buyer accepted",
      // Present tense only while the buyer is still working on it; afterwards it is just history.
      detail:
        role === "buyer"
          ? s === "accepted"
            ? "You took this order. Once the voucher buyer is ready, confirm it from your wallet, then buy the voucher and submit its code before the deadline."
            : "You took this order."
          : f.accepted
            ? s === "accepted"
              ? role === "spender" ? "A USDC buyer took your order and is delivering your voucher." : "The USDC buyer is delivering the voucher."
              : role === "spender" ? "A USDC buyer took your order." : "The USDC buyer took the order."
            : role === "spender" ? "Waiting for a USDC buyer to take your order." : "Waiting for a USDC buyer to take the order.",
      at: r.acceptedAt ?? null,
      actor: r.crypto_buyer,
      state: f.accepted ? "done" : "upcoming",
      deadline: s === "accepted" && r.fulfilDeadline ? { label: role === "buyer" ? "You deliver by" : "USDC buyer delivers by", at: r.fulfilDeadline } : null,
    }),
  );

  // The spender's gasless "Ready" permit: the escrow's EIP-712 Assign naming this buyer. The buyer uses it in their own
  // `accept` transaction, which binds them on-chain. Until that confirms, the USDC is not bound to them.
  {
    const rd = r.ready ?? null;
    const expired = !!rd && rd.validUntil * 1000 <= now;
    const live = s === "accepted";
    const until = rd ? new Date(rd.validUntil * 1000).toISOString() : null;
    stages.push(
      mk({
        key: "ready",
        title: role === "spender" ? (rd ? "You pressed Ready" : "You press Ready") : rd ? "Voucher buyer is ready" : "Voucher buyer presses Ready",
        detail: rd
          ? role === "spender"
            ? live && !expired
              ? "You told the USDC buyer you're ready. They confirm the order from their wallet, then hand over the voucher code."
              : live
                ? "Your Ready permit expired. Sign again so the USDC buyer can confirm and hand over the code."
                : "You told the USDC buyer you were ready."
            : role === "buyer"
              ? live && !expired
                ? "The voucher buyer is ready. Confirm the order from your wallet first. Only then buy the voucher and hand over the code."
                : live
                  ? "The voucher buyer's Ready permit expired. Ask them to press Ready again."
                  : "The voucher buyer said they were ready."
              : "The voucher buyer signalled they were ready to receive the code."
          : role === "spender"
            ? "Tell the USDC buyer you're ready to receive the voucher code. It's a free signature, no gas."
            : role === "buyer"
              ? "Waiting for the voucher buyer to press Ready."
              : "Once a USDC buyer accepts, the voucher buyer says they're ready to receive the code.",
        at: rd?.signedAt ?? null,
        actor: rd ? r.crypto_spender : null,
        state: rd ? "done" : "upcoming",
        tone: expired && live ? "amber" : "mint",
        facts: rd && live ? [{ label: "Permit", value: expired ? "Expired" : `Valid until ${new Date(rd.validUntil * 1000).toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" })}` }] : [],
        deadline: rd && live && !expired && until ? { label: "Permit valid for", at: until } : null,
      }),
    );
  }

  stages.push(
    mk({
      key: "code",
      title: "Voucher code submitted",
      detail:
        role === "spender"
          ? s === "code_submitted"
            ? "The USDC buyer handed over your voucher. Check it works, then release."
            : "The USDC buyer handed over your voucher."
          : role === "buyer"
            ? s === "code_submitted"
              ? "You submitted the code. The voucher buyer now checks it."
              : "You submitted the code."
            : "The USDC buyer handed over the voucher for the voucher buyer to check.",
      at: r.codeSubmittedAt ?? null,
      actor: r.crypto_buyer,
      state: f.code ? "done" : "upcoming",
      deadline: s === "code_submitted" && r.reviewDeadline ? { label: role === "buyer" ? "You're paid automatically from" : role === "spender" ? "Release or dispute before" : "Review window ends at", at: r.reviewDeadline } : null,
    }),
  );

  if (f.disputed) {
    const res = r.resolution;
    const raisedBy = r.disputedBy ? (sameAddr(r.disputedBy, r.crypto_spender) ? "spender" : "buyer") : null;
    const who = raisedBy ? nameOf(r.disputedBy, role, raisedBy) : "a party";
    const factsList: Stage["facts"] = [];
    if (r.disputeReason) factsList.push({ label: "Reason", value: r.disputeReason });
    if (res) {
      factsList.push({ label: "Ruling", value: res.outcome === "release" ? "USDC released to the USDC buyer" : "USDC refunded to the voucher buyer" });
      if (res.note) factsList.push({ label: "Arbiter note", value: res.note });
    }
    stages.push(
      mk({
        key: "dispute",
        title: s === "disputed" ? "Dispute under review" : "Dispute resolved",
        detail:
          s === "disputed"
            ? `${who[0].toUpperCase()}${who.slice(1)} disputed this order. The arbiter decides how the escrow is split between the USDC buyer and the voucher buyer.`
            : `${who[0].toUpperCase()}${who.slice(1)} disputed this order and it was resolved.`,
        at: res?.at ?? r.disputedAt ?? null,
        actor: r.disputedBy ?? null,
        state: s === "disputed" ? "current" : "done",
        tone: "rose",
        facts: factsList,
      }),
    );
  }

  // Outcome: released, refunded, cancelled, or still ahead.
  const settling = s === "releasing" || s === "refunding";
  let outcome: Stage;
  if (s === "released") {
    outcome = mk({
      key: "outcome",
      title: role === "buyer" ? "USDC paid to you" : "USDC paid to the USDC buyer",
      detail: role === "buyer" ? `You received ${amt}.` : role === "spender" ? `${amt} went to the USDC buyer. The voucher is yours.` : `${amt} was paid to the USDC buyer.`,
      at: r.settledAt ?? null,
      actor: r.crypto_buyer,
      tx: r.releaseTxHash,
      state: "done",
    });
  } else if (s === "refunded") {
    outcome = mk({
      key: "outcome",
      title: role === "spender" ? "USDC refunded to you" : "USDC refunded to the voucher buyer",
      detail: role === "spender" ? `${locked} came back to you.` : role === "buyer" ? "This order was refunded to the voucher buyer. You were not paid." : `${locked} was returned to the voucher buyer.`,
      at: r.settledAt ?? null,
      actor: r.crypto_spender,
      tx: r.refundTxHash,
      state: "done",
      tone: "mute",
    });
  } else if (s === "cancelled") {
    outcome = mk({
      key: "outcome",
      title: "Order cancelled",
      detail: wasFunded(r) ? (role === "spender" ? `You cancelled before a USDC buyer was bound. ${locked} came back to you.` : `Cancelled by the voucher buyer before a USDC buyer was bound. ${locked} went back to them.`) : "Cancelled before any USDC was locked.",
      at: r.updatedAt,
      actor: r.crypto_spender,
      state: "done",
      tone: "mute",
    });
  } else if (settling) {
    outcome = mk({
      key: "outcome",
      title: s === "releasing" ? (role === "buyer" ? "Sending USDC to you" : "Sending USDC to the USDC buyer") : role === "spender" ? "Returning USDC to you" : "Returning USDC to the voucher buyer",
      detail: "The server is waiting to see the escrow transaction confirmed on Arc.",
      state: "current",
      tone: "iris",
    });
  } else {
    outcome = mk({
      key: "outcome",
      title: "Settlement",
      detail: role === "buyer" ? "Ends with the USDC paid to you, or refunded to the voucher buyer if the voucher isn't delivered." : role === "spender" ? "Ends with the USDC paid to the USDC buyer, or refunded to you if the voucher isn't delivered." : "Ends with the USDC paid to the USDC buyer, or refunded to the voucher buyer if something goes wrong.",
      state: "upcoming",
    });
  }
  stages.push(outcome);

  // No Ready was sent, but the code arrived (or the order ended) anyway: it was never needed, so it is not "pending".
  const readyStage = stages.find((x) => x.key === "ready")!;
  if (readyStage.state === "upcoming" && (f.code || f.settled)) {
    readyStage.state = "skipped";
    readyStage.detail = "No Ready signal was sent for this order.";
  }
  // Exactly one "current" stage while the order is live: the first stage still ahead of us.
  if (!f.settled && !settling && s !== "disputed") {
    const first = stages.find((x) => x.state === "upcoming");
    if (first) first.state = "current";
  }
  // Once settled, anything that never happened is "skipped", and says so instead of describing an action.
  if (f.settled) {
    const NEVER: Partial<Record<StageKey, string>> = {
      funded: "No USDC was ever locked for this order.",
      accepted: "No USDC buyer took this order.",
      ready: "No Ready signal was sent for this order.",
      code: "No voucher was handed over.",
    };
    for (const st of stages) {
      if (st.state !== "upcoming") continue;
      st.state = "skipped";
      st.detail = NEVER[st.key] ?? st.detail;
      st.deadline = null;
    }
  }
  return stages;
}

/** INR per USDC implied by the two amounts (what the spender is effectively paying). */
export function impliedRate(r: Pick<ApiRequest, "amountInr" | "amountUsdc">): number | null {
  const u = Number(r.amountUsdc);
  return u > 0 ? r.amountInr / u : null;
}
