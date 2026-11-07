/**
 * Pure logic for the order tracker (`/track?id=…`): who is the viewer, what has happened so far, what happens next.
 * No React, no network. Everything is derived from the request document the API returns (`GET /requests/:id`).
 *
 * Roles (backend names in brackets):
 *   spender  [crypto_spender]  locked USDC in escrow and wants the gift voucher
 *   buyer    [crypto_buyer]    buys the voucher with INR and receives the USDC
 *   observer                   anyone else, or nobody connected
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

export type NextStep = {
  tone: Tone;
  title: string;
  body: string;
  deadline: { label: string; at: string } | null;
  /** What the page may offer. The page decides how to render each. "ready" and "settle" live inside the lifecycle steps. */
  cta: "cancel" | "trade" | "fill" | "ready" | "settle" | "none";
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
  if (!addr) return party === "buyer" ? "a buyer" : "the spender";
  if (role === party) return "you";
  return `the ${party}`;
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

const usdc = (r: ApiRequest) => (Number(r.amountUsdc) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export function buildStages(r: ApiRequest, role: Role, brandName: string = r.brand, now: number = Date.now()): Stage[] {
  const f = facts(r);
  const s = r.status;
  const amt = `${usdc(r)} USDC`;
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
      detail: role === "spender" ? "You asked for this voucher." : `The spender asked for a ₹${r.amountInr.toLocaleString("en-IN")} ${brandName} voucher.`,
      at: r.createdAt,
      actor: r.crypto_spender,
      state: "done",
    }),
  );

  stages.push(
    mk({
      key: "funded",
      title: "USDC locked in escrow",
      detail: role === "spender" ? `You deposited ${amt}. It stays locked until the trade settles.` : `${amt} is held by the escrow contract, so the funds really exist.`,
      at: r.fundedAt ?? null,
      actor: r.crypto_spender,
      tx: r.escrowTxHash,
      state: f.funded ? "done" : "upcoming",
    }),
  );

  stages.push(
    mk({
      key: "accepted",
      title: "Buyer accepted",
      // Present tense only while the buyer is still working on it; afterwards it is just history.
      detail:
        role === "buyer"
          ? s === "accepted"
            ? "You took this order. Buy the voucher and submit its code before the deadline."
            : "You took this order."
          : f.accepted
            ? s === "accepted"
              ? "A verified buyer is purchasing the voucher."
              : "A verified buyer took the order."
            : "Waiting for a World-ID-verified buyer to take the order.",
      at: r.acceptedAt ?? null,
      actor: r.crypto_buyer,
      state: f.accepted ? "done" : "upcoming",
      deadline: s === "accepted" && r.fulfilDeadline ? { label: role === "buyer" ? "Submit the code by" : "Buyer must submit the code by", at: r.fulfilDeadline } : null,
    }),
  );

  // The spender's gasless "Ready" permit (EIP-712) naming this buyer. Evidence the spender is ready; it does not lock the buyer.
  {
    const rd = r.ready ?? null;
    const expired = !!rd && rd.validUntil * 1000 <= now;
    const live = s === "accepted";
    const until = rd ? new Date(rd.validUntil * 1000).toISOString() : null;
    stages.push(
      mk({
        key: "ready",
        title: rd ? "Spender is ready" : "Spender says they're ready",
        detail: rd
          ? role === "spender"
            ? live && !expired
              ? "You told the buyer you're ready. They can now hand over the voucher code."
              : live
                ? "Your Ready permit expired. Sign again so the buyer can hand over the code."
                : "You told the buyer you were ready."
            : role === "buyer"
              ? live && !expired
                ? "The spender is ready. Buy the voucher and hand over the code."
                : live
                  ? "The spender's Ready permit expired. Ask them to sign again."
                  : "The spender said they were ready."
              : "The spender signalled they were ready to receive the code."
          : role === "spender"
            ? "Tell the buyer you're ready to receive the voucher code. It's a free signature, no gas."
            : role === "buyer"
              ? "Waiting for the spender to say they're ready."
              : "Once a buyer accepts, the spender says they're ready to receive the code.",
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
            ? "The buyer handed over the voucher. Check it works, then confirm."
            : "The buyer handed over the voucher."
          : role === "buyer"
            ? s === "code_submitted"
              ? "You submitted the code. The spender now checks it."
              : "You submitted the code."
            : "The buyer handed over the voucher for the spender to check.",
      at: r.codeSubmittedAt ?? null,
      actor: r.crypto_buyer,
      state: f.code ? "done" : "upcoming",
      deadline: s === "code_submitted" && r.reviewDeadline ? { label: role === "buyer" ? "USDC auto-releases to you at" : role === "spender" ? "Confirm or dispute before" : "Auto-release at", at: r.reviewDeadline } : null,
    }),
  );

  if (f.disputed) {
    const res = r.resolution;
    const raisedBy = r.disputedBy ? (sameAddr(r.disputedBy, r.crypto_spender) ? "spender" : "buyer") : null;
    const who = raisedBy ? nameOf(r.disputedBy, role, raisedBy) : "a party";
    const factsList: Stage["facts"] = [];
    if (r.disputeReason) factsList.push({ label: "Reason", value: r.disputeReason });
    if (res) {
      factsList.push({ label: "Ruling", value: res.outcome === "release" ? "USDC released to the buyer" : "USDC refunded to the spender" });
      if (res.note) factsList.push({ label: "Admin note", value: res.note });
    }
    stages.push(
      mk({
        key: "dispute",
        title: s === "disputed" ? "Dispute under review" : "Dispute resolved",
        detail:
          s === "disputed"
            ? `${who[0].toUpperCase()}${who.slice(1)} disputed this order. An admin decides whether the buyer is paid or the spender is refunded.`
            : `${who[0].toUpperCase()}${who.slice(1)} disputed this order and an admin ruled on it.`,
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
      title: "USDC released to the buyer",
      detail: role === "buyer" ? `You received ${amt}.` : role === "spender" ? `${amt} went to the buyer. The voucher is yours.` : `${amt} was paid to the buyer.`,
      at: r.settledAt ?? null,
      actor: r.crypto_buyer,
      tx: r.releaseTxHash,
      state: "done",
    });
  } else if (s === "refunded") {
    outcome = mk({
      key: "outcome",
      title: "USDC refunded to the spender",
      detail: role === "spender" ? `${amt} came back to you.` : role === "buyer" ? "This order was refunded to the spender. You were not paid." : `${amt} was returned to the spender.`,
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
      detail: "Cancelled before any USDC was locked.",
      at: r.updatedAt,
      actor: r.crypto_spender,
      state: "done",
      tone: "mute",
    });
  } else if (settling) {
    outcome = mk({
      key: "outcome",
      title: s === "releasing" ? "Sending USDC to the buyer" : "Returning USDC to the spender",
      detail: "The escrow transaction is being confirmed on Arc.",
      state: "current",
      tone: "iris",
    });
  } else {
    outcome = mk({
      key: "outcome",
      title: "Settlement",
      detail: "Ends with USDC released to the buyer, or refunded to the spender if something goes wrong.",
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
      accepted: "No buyer took this order.",
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

export function nextStep(r: ApiRequest, role: Role, brandName: string = r.brand, now: number = Date.now()): NextStep {
  const amt = `${usdc(r)} USDC`;
  const none = (tone: Tone, title: string, body: string): NextStep => ({ tone, title, body, deadline: null, cta: "none" });

  switch (r.status) {
    case "pending_funding":
      return role === "spender"
        ? { tone: "amber", title: "Deposit USDC to publish this order", body: `The order isn't live until ${amt} is deposited into escrow. If you won't deposit, cancel it.`, deadline: null, cta: "cancel" }
        : none("mute", "Not live yet", "The spender hasn't deposited the USDC, so nobody can take this order.");
    case "open":
      if (role === "spender") return { tone: "mint", title: "Waiting for a buyer", body: `Your ${amt} is locked and the order is in the order book. You can cancel and get it back until someone accepts.`, deadline: null, cta: "cancel" };
      return { tone: "mint", title: "This order is open", body: `Buy a ₹${r.amountInr.toLocaleString("en-IN")} ${brandName} voucher on your best card and you receive ${amt}.`, deadline: null, cta: role === "observer" ? "fill" : "none" };
    case "accepted": {
      const readyLive = !!r.ready && r.ready.validUntil * 1000 > now;
      if (role === "spender") {
        return readyLive
          ? { tone: "amber", title: "You're ready. Waiting for the buyer's code", body: "The buyer can hand the voucher over now. If they miss the deadline, the order reopens and your USDC stays locked for the next buyer.", deadline: r.fulfilDeadline ? { label: "Buyer must submit by", at: r.fulfilDeadline } : null, cta: "none" }
          : { tone: "amber", title: r.ready ? "Sign Ready again" : "Tell the buyer you're ready", body: "A buyer accepted your order. Press Ready in the lifecycle below: a free signature (no gas) that lets them hand over the voucher code.", deadline: r.fulfilDeadline ? { label: "Buyer must submit by", at: r.fulfilDeadline } : null, cta: "ready" };
      }
      if (role === "buyer") {
        const by = r.fulfilDeadline ? { label: "Submit the code by", at: r.fulfilDeadline } : null;
        // The bank link only appears once the spender has said they're ready.
        return readyLive
          ? { tone: "amber", title: "The spender is ready. Buy the voucher", body: "Pay on your card, then seal the code below.", deadline: by, cta: "trade" }
          : { tone: "amber", title: "Waiting for the spender to be ready", body: "The link appears here once they press Ready.", deadline: by, cta: "none" };
      }
      return { tone: "amber", title: "A buyer is purchasing the voucher", body: "Nothing for you to do yet. If they miss the deadline, the order reopens.", deadline: r.fulfilDeadline ? { label: "Buyer must submit by", at: r.fulfilDeadline } : null, cta: "none" };
    }
    case "code_submitted":
      return role === "spender"
        ? { tone: "iris", title: "Check the voucher, then confirm", body: "Check the voucher is live, then settle to pay the buyer, or raise a dispute if it doesn't work. Both are in the lifecycle below. If you do nothing, the USDC is released automatically.", deadline: r.reviewDeadline ? { label: "Auto-release at", at: r.reviewDeadline } : null, cta: "settle" }
        : { tone: "iris", title: role === "buyer" ? "Waiting for the spender to confirm" : "The spender is checking the voucher", body: role === "buyer" ? `Nothing to do. When they confirm, or if they don't respond by the deadline, ${amt} is released to you.` : "The voucher was handed over and is being checked.", deadline: r.reviewDeadline ? { label: "Auto-release at", at: r.reviewDeadline } : null, cta: "none" };
    case "disputed":
      return { tone: "rose", title: "Under review by an admin", body: "The funds stay in escrow until the admin releases them to the buyer or refunds the spender.", deadline: null, cta: role === "observer" ? "none" : "trade" };
    case "releasing":
      return none("iris", "Paying out", `${amt} is being sent to the buyer on Arc.`);
    case "released":
      return role === "buyer" ? none("mint", "Completed. You were paid", `${amt} reached your wallet.`) : role === "spender" ? none("mint", "Completed", `The buyer was paid ${amt}. The voucher is yours.`) : none("mint", "Completed", `The buyer was paid ${amt}.`);
    case "refunding":
      return none("iris", "Refunding", `${amt} is being returned to the spender.`);
    case "refunded":
      return role === "spender" ? none("mute", "Refunded", `${amt} was returned to you.`) : role === "buyer" ? none("mute", "Refunded to the spender", "You were not paid for this order.") : none("mute", "Refunded", `${amt} was returned to the spender.`);
    case "cancelled":
      return none("mute", "Cancelled", "This order was cancelled before any USDC was locked.");
    default:
      return none("mute", "Unknown state", `The order reports status "${String(r.status)}".`);
  }
}

/** INR per USDC implied by the two amounts (what the spender is effectively paying). */
export function impliedRate(r: Pick<ApiRequest, "amountInr" | "amountUsdc">): number | null {
  const u = Number(r.amountUsdc);
  return u > 0 ? r.amountInr / u : null;
}
