/**
 * One order, as the person looking at it should see it: whose move it is, what to do next, the deadline that
 * matters now, and which actions to offer. Used by the order list and the order page, so they never disagree.
 * Pure (no React, no network, no env), so node tests can cover every combination.
 *
 * Role names on screen (internal names in brackets):
 *   voucher buyer  [spender, crypto_spender]  locks USDC, receives the gift voucher
 *   USDC buyer     [buyer, crypto_buyer]      buys the voucher with their own card, hands over the code, receives USDC
 *
 * The chain decides which actions exist. The server status is used for wording and for steps that only the server
 * knows about (Ready, whether the code was sent). When they disagree the chain wins and the page says the server is
 * catching up. When the escrow can't be read (`chain.kind === "unknown"`), only actions that need no chain fact are
 * offered; `"server-only"` is for the order list, which doesn't read the chain, and `"mock"` for a development server.
 */
import type { ApiRequest, ReqStatus } from "./api";
import { ST, judgeEscrow, type EscrowRecord, type OnchainEscrow } from "./onchain.ts";

export type Role = "spender" | "buyer" | "observer";
export type Tone = "mint" | "amber" | "iris" | "rose" | "mute";

export const ROLE_NAME = { spender: "voucher buyer", buyer: "USDC buyer" } as const;

export type ChainInput = { kind: "ok"; escrow: OnchainEscrow } | { kind: "mock" } | { kind: "unknown" } | { kind: "server-only" };

export type Action =
  /** voucher buyer: wallet `cancel`, then POST /cancel */
  | "cancel"
  /** voucher buyer: nothing was deposited, POST /cancel only */
  | "cancelNoTx"
  /** voucher buyer: sign the Ready (Assign) permit */
  | "ready"
  /** USDC buyer: wallet `accept` with the Ready permit */
  | "bind"
  /** USDC buyer: the bank / portal link to buy the voucher */
  | "buyVoucher"
  /** USDC buyer: markDelivered (skipped if already on-chain) + sealed code */
  | "deliver"
  /** USDC buyer: wallet `unassign` */
  | "unassign"
  /** USDC buyer: wallet `concede` */
  | "concede"
  /** voucher buyer: wallet `release`, then POST /confirm */
  | "release"
  /** voucher buyer: wallet `dispute`, then POST /dispute */
  | "dispute"
  /** either party: link to the dispute page */
  | "openDispute"
  /** someone else: take this open order */
  | "fill";

/** Actions that end with a call to the NetPositive server, so they need a signed-in session for this wallet. */
export const SERVER_ACTIONS: ReadonlySet<Action> = new Set<Action>(["cancel", "cancelNoTx", "ready", "deliver", "release", "dispute"]);

export type Phase = "open" | "fulfil" | "review" | "dispute";
export type Deadline = { phase: Phase; at: number; source: "chain" | "server" };
export type Note = { tone: Tone; text: string };
export type ReadyState = "none" | "valid" | "expired" | "stale";

export type OrderView = {
  tone: Tone;
  /** One line: whose move it is and what happens next, from the viewer's side. */
  headline: string;
  body: string;
  /** Who has to act now. */
  actor: "you" | "voucher buyer" | "USDC buyer" | "arbiter" | "automatic" | "nobody";
  deadline: Deadline | null;
  actions: Action[];
  notes: Note[];
  /** The chain contradicts the order in a way that makes any step unsafe. Nothing is offered while this is set. */
  stop: string | null;
  ready: ReadyState;
  /** The USDC buyer already marked delivered on-chain, so `deliver` only sends the code. */
  deliveredOnChain: boolean;
  /** Some offered action needs a server session this wallet doesn't have. */
  needsSignIn: boolean;
  /** The chain is the source of these facts, and the server status hasn't caught up. */
  serverBehind: boolean;
};

export type ViewInput = {
  req: ApiRequest;
  role: Role;
  chain: ChainInput;
  /** Milliseconds. */
  now: number;
  /** A server session exists for the connected wallet. */
  signedIn?: boolean;
  /** The connected wallet, if any. */
  viewer?: string | null;
  brandName?: string;
};

const same = (a?: string | null, b?: string | null) => !!a && !!b && a.toLowerCase() === b.toLowerCase();
const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const amountOf = (r: ApiRequest) => `${fmt(Number(r.amountUsdc) || 0)} USDC`;
const lockedOf = (r: ApiRequest) => (r.totalUsdcBaseUnits && /^\d+$/.test(r.totalUsdcBaseUnits) ? `${fmt(Number(r.totalUsdcBaseUnits) / 1e6)} USDC` : amountOf(r));
const FINAL = new Set<ReqStatus>(["released", "refunded", "cancelled"]);

/** The voucher buyer's Ready permit, as the USDC buyer could use it right now. */
export function readyState(req: Pick<ApiRequest, "ready">, chain: Pick<EscrowRecord, "epoch"> | null, nowSec: number): ReadyState {
  const r = req.ready;
  if (!r) return "none";
  if (r.validUntil <= nowSec) return "expired";
  if (chain && typeof r.epoch === "number" && r.epoch !== chain.epoch) return "stale";
  return "valid";
}

/** "1 h 52 m", "23 m", "45 s", "2 d 3 h". */
export function duration(sec: number) {
  const s = Math.max(0, Math.floor(sec));
  if (s < 60) return `${s} s`;
  if (s < 3600) return `${Math.floor(s / 60)} m`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ${String(Math.floor((s % 3600) / 60)).padStart(2, "0")} m`;
  return `${Math.floor(s / 86400)} d ${Math.floor((s % 86400) / 3600)} h`;
}

/**
 * The deadline as one sentence that names whose deadline it is and what happens when it passes.
 * Called every second by the page, so it stays live.
 */
export function deadlineLine(d: Deadline, role: Role, nowMs: number): string {
  const left = d.at - nowMs / 1000;
  const t = duration(left);
  const over = left <= 0;
  switch (d.phase) {
    case "open":
      if (over) return role === "spender" ? "Your order expired unfilled. Your USDC comes back to you automatically within a minute or two." : "This order expired unfilled. The USDC goes back to the voucher buyer automatically.";
      if (role === "spender") return `Your order stays open for ${t}. If no USDC buyer is bound by then, your USDC comes back to you.`;
      if (role === "buyer") return `The order closes in ${t}. Confirm it on-chain before then, or it goes back to the voucher buyer.`;
      return `Open for ${t} more.`;
    case "fulfil":
      if (over) return role === "buyer" ? "Your delivery time is up. Don't buy the voucher now: the USDC goes back to the voucher buyer automatically within a minute or two." : role === "spender" ? "The USDC buyer's delivery time is up. Your USDC comes back to you automatically within a minute or two." : "The delivery time is up. The USDC goes back to the voucher buyer automatically.";
      if (role === "buyer") return `You have ${t} to deliver. After that the USDC goes back to the voucher buyer.`;
      if (role === "spender") return `The USDC buyer has ${t} to deliver. After that your USDC comes back to you.`;
      return `The USDC buyer has ${t} to deliver. After that the USDC goes back to the voucher buyer.`;
    case "review":
      if (over) return role === "buyer" ? "The review window has ended. You are paid automatically within a minute or two." : role === "spender" ? "Your review window has ended. The USDC buyer is paid automatically within a minute or two." : "The review window has ended. The USDC buyer is paid automatically.";
      if (role === "spender") return `You have ${t} to check the voucher and release or dispute. After that the USDC buyer is paid automatically.`;
      if (role === "buyer") return `The voucher buyer has ${t} to check your voucher. After that you are paid automatically.`;
      return `The voucher buyer has ${t} to check the voucher. After that the USDC buyer is paid automatically.`;
    case "dispute":
      if (over) return "The arbiter didn't rule in time. The USDC can now be refunded to the voucher buyer; NetPositive's keeper normally sends it within a minute or two.";
      return `The arbiter has ${t} to rule. If nobody rules, the USDC goes back to the voucher buyer.`;
  }
}

function serverDeadline(req: ApiRequest): Deadline | null {
  const at = (iso: string | null) => (iso ? Math.floor(Date.parse(iso) / 1000) : NaN);
  if (req.status === "accepted" && req.fulfilDeadline && Number.isFinite(at(req.fulfilDeadline))) return { phase: "fulfil", at: at(req.fulfilDeadline), source: "server" };
  if (req.status === "code_submitted" && req.reviewDeadline && Number.isFinite(at(req.reviewDeadline))) return { phase: "review", at: at(req.reviewDeadline), source: "server" };
  return null;
}

function chainDeadline(e: EscrowRecord): Deadline | null {
  if (e.status === ST.Funded) return { phase: e.fulfiller ? "fulfil" : "open", at: e.deadline, source: "chain" };
  if (e.status === ST.Delivered) return { phase: "review", at: e.deadline, source: "chain" };
  if (e.status === ST.Disputed) return { phase: "dispute", at: e.deadline, source: "chain" };
  return null;
}

/** What the server status would be if it had caught up with this chain state. */
function serverAgrees(status: ReqStatus, e: EscrowRecord): boolean {
  switch (e.status) {
    case ST.None:
      return status === "pending_funding" || status === "cancelled";
    case ST.Funded:
      return status === "open" || status === "accepted" || status === "pending_funding" || status === "refunding";
    case ST.Delivered:
      return status === "accepted" || status === "code_submitted" || status === "releasing" || status === "refunding";
    case ST.Disputed:
      return status === "disputed" || status === "releasing" || status === "refunding";
    case ST.Released:
      return status === "released" || status === "releasing";
    case ST.Refunded:
      return status === "refunded" || status === "cancelled" || status === "refunding";
    case ST.Resolved:
      return status === "released" || status === "refunded" || status === "releasing" || status === "refunding";
    default:
      return true;
  }
}

export function orderView(input: ViewInput): OrderView {
  const { req, role, chain, now } = input;
  const nowSec = Math.floor(now / 1000);
  const amt = amountOf(req);
  const locked = lockedOf(req);
  const v = base(req, role, chain, nowSec, amt, locked, input.brandName ?? req.brand);

  // Read-only for anyone who isn't a party.
  if (role === "observer") {
    v.notes.unshift({ tone: "mute", text: v.actions.includes("fill") ? "You're not part of this order yet. To take it as the USDC buyer, pick how to buy the voucher below." : input.viewer ? `Your connected wallet (${input.viewer.slice(0, 6)}…${input.viewer.slice(-4)}) isn't part of this order, so this page is read-only. To act on it, switch to the wallet that created or accepted it.` : "You're viewing this order as a guest. Connect the wallet that created or accepted it to act on it." });
  }
  v.needsSignIn = role !== "observer" && !input.signedIn && v.actions.some((a) => SERVER_ACTIONS.has(a));
  return v;
}

function base(req: ApiRequest, role: Role, chain: ChainInput, nowSec: number, amt: string, locked: string, brandName: string): OrderView {
  const v: OrderView = { tone: "mute", headline: "", body: "", actor: "nobody", deadline: null, actions: [], notes: [], stop: null, ready: "none", deliveredOnChain: false, needsSignIn: false, serverBehind: false };
  const set = (p: Partial<OrderView>) => Object.assign(v, p);
  const s = req.status;
  const voucher = `₹${req.amountInr.toLocaleString("en-IN")} ${brandName} voucher`;

  if (chain.kind !== "ok") {
    v.ready = readyState(req, null, nowSec);
    v.deadline = serverDeadline(req);
    serverOnly(v, req, role, chain, amt, locked, voucher);
    return v;
  }

  const e = chain.escrow;
  v.ready = readyState(req, e, nowSec);
  v.deadline = chainDeadline(e);
  v.serverBehind = !serverAgrees(s, e);
  const verdict = judgeEscrow(req, e, nowSec * 1000);
  if (verdict.tone === "bad") {
    set({ tone: "rose", headline: "Stop: the escrow doesn't match this order", body: verdict.detail, actor: "nobody", stop: verdict.detail, actions: [] });
    return v;
  }
  if (v.serverBehind) v.notes.push({ tone: "iris", text: "NetPositive's server is catching up with the escrow. The steps shown here follow the contract; the status label updates within a minute or two." });

  const past = nowSec >= e.deadline;
  const viewerBound = role === "buyer" && !!e.fulfiller && same(e.fulfiller, req.crypto_buyer);

  switch (e.status) {
    case ST.None: {
      if (s === "cancelled") return ended(v, "mute", "Cancelled", "This order was cancelled before any USDC was locked.");
      if (role === "spender") return set({ tone: "amber", actor: "you", headline: "Your move: deposit USDC to publish this order", body: `The order isn't live until ${locked} is in escrow. If you won't deposit, cancel it (no transaction needed).`, actions: ["cancelNoTx"] });
      return set({ tone: "mute", actor: "voucher buyer", headline: "Not live yet", body: "The voucher buyer hasn't deposited the USDC, so nobody can take this order yet." });
    }
    case ST.Funded: {
      if (!e.fulfiller) {
        const expired = nowSec >= e.openUntil;
        if (expired) {
          v.notes.push({ tone: "iris", text: "The order's time ran out on-chain. The refund to the voucher buyer is sent automatically within a minute or two." });
          if (role === "spender") return set({ tone: "iris", actor: "automatic", headline: "Your order expired. Your USDC is coming back", body: `${locked} returns to your wallet automatically. You can also cancel now to get it back straight away.`, actions: ["cancel"] });
          if (role === "buyer") return set({ tone: "amber", actor: "automatic", headline: "This order expired before you confirmed it", body: "Don't buy the voucher. The USDC goes back to the voucher buyer." });
          return set({ tone: "mute", actor: "automatic", headline: "This order expired", body: "The USDC goes back to the voucher buyer." });
        }
        if (s === "accepted" && req.crypto_buyer) {
          if (role === "spender") {
            const needReady = v.ready !== "valid";
            v.notes.push({ tone: "mute", text: "You can still cancel: no USDC buyer is bound on-chain yet." });
            return needReady
              ? set({ tone: "amber", actor: "you", headline: v.ready === "none" ? "Your move: press Ready for the USDC buyer" : "Your move: sign Ready again", body: v.ready === "none" ? "A USDC buyer accepted your order. Ready is a free signature (no gas) that lets them, and only them, bind to your order on-chain." : v.ready === "stale" ? "Your earlier Ready no longer works on-chain (the order went back to the book since). Sign it again so the USDC buyer can confirm." : "Your Ready expired before the USDC buyer used it. Sign it again so they can confirm the order.", actions: ["ready", "cancel"] })
              : set({ tone: "amber", actor: "USDC buyer", headline: "Waiting for the USDC buyer to confirm on-chain", body: "You're ready. The USDC buyer now confirms the order from their wallet, then buys your voucher and hands over the code.", actions: ["cancel"] });
          }
          if (role === "buyer") {
            v.notes.push({ tone: "amber", text: "Don't buy the voucher yet: until you confirm on-chain, the USDC is not bound to you and the voucher buyer can still cancel." });
            return v.ready === "valid"
              ? set({ tone: "amber", actor: "you", headline: "Your move: confirm the order on-chain", body: "The voucher buyer is ready. One transaction from your wallet binds the locked USDC to you. Buy the voucher only after it confirms.", actions: ["bind"] })
              : set({ tone: "amber", actor: "voucher buyer", headline: v.ready === "none" ? "Waiting for the voucher buyer to press Ready" : "Waiting for the voucher buyer to press Ready again", body: v.ready === "none" ? "Your next step appears here as soon as they do." : "Their earlier Ready can't be used any more. Ask them to press Ready again; your next step appears here when they do." });
          }
          return set({ tone: "amber", actor: "USDC buyer", headline: "A USDC buyer accepted this order", body: "Waiting for them to confirm it on-chain." });
        }
        // Open on-chain, nobody accepted (or the server reopened it).
        if (role === "spender") return set({ tone: "mint", actor: "nobody", headline: "Waiting for a USDC buyer", body: `Your ${locked} is locked and the order is in the order book. Until a USDC buyer is bound on-chain you can cancel and get all of it back.`, actions: ["cancel"] });
        if (role === "buyer") return set({ tone: "mute", actor: "nobody", headline: "You're not bound to this order", body: "The order is back in the order book. Don't buy the voucher for it." });
        return set({ tone: "mint", actor: "nobody", headline: "This order is open", body: `Buy a ${voucher} on your best card and you receive ${amt}.`, actions: s === "open" || s === "pending_funding" ? ["fill"] : [] });
      }
      // A USDC buyer is bound.
      if (past) {
        v.notes.push({ tone: "iris", text: "The delivery deadline passed on-chain. The refund to the voucher buyer is sent automatically within a minute or two." });
        if (role === "spender") return set({ tone: "iris", actor: "automatic", headline: "Delivery time is up. Your USDC is coming back", body: `${locked} returns to your wallet automatically. If you did receive a working voucher, you can still release instead.`, actions: ["release"] });
        if (role === "buyer") return set({ tone: "amber", actor: "automatic", headline: "Your delivery time is up", body: "Don't buy the voucher now. The USDC goes back to the voucher buyer." });
        return set({ tone: "mute", actor: "automatic", headline: "Delivery time is up", body: "The USDC goes back to the voucher buyer." });
      }
      if (role === "buyer" && viewerBound) {
        return set({ tone: "amber", actor: "you", headline: "Your move: buy the voucher and submit the code", body: `You're confirmed on-chain, so the USDC is bound to you. Buy the ${voucher}, then submit its code below to be paid ${amt}.`, actions: ["buyVoucher", "deliver", "unassign"] });
      }
      if (role === "spender") {
        v.notes.push({ tone: "mute", text: "Cancel isn't possible now: the USDC buyer is bound on-chain. If they don't deliver by the deadline, your USDC comes back automatically; after delivery you can dispute." });
        return set({ tone: "amber", actor: "USDC buyer", headline: "Waiting for the USDC buyer to deliver your voucher", body: "They're confirmed on-chain and are buying the voucher. You'll be asked to check it once the code arrives.", actions: ["release"] });
      }
      return set({ tone: "amber", actor: "USDC buyer", headline: "The USDC buyer is buying the voucher", body: "They're bound to the order on-chain." });
    }
    case ST.Delivered: {
      v.deliveredOnChain = true;
      const codeIn = s === "code_submitted" || s === "disputed" || s === "releasing" || s === "released";
      if (past) {
        v.notes.push({ tone: "iris", text: "The review window ended on-chain. The USDC buyer is paid automatically within a minute or two." });
        if (role === "spender") return set({ tone: "iris", actor: "automatic", headline: "Review window over. The USDC buyer is being paid", body: `${amt} goes to the USDC buyer automatically.` });
        if (role === "buyer") return set({ tone: "mint", actor: "automatic", headline: "You're being paid", body: `${amt} reaches your wallet automatically within a minute or two.`, actions: codeIn ? [] : ["deliver"] });
        return set({ tone: "iris", actor: "automatic", headline: "The USDC buyer is being paid", body: "The review window has ended." });
      }
      if (role === "spender") {
        return codeIn
          ? set({ tone: "iris", actor: "you", headline: "Your move: check the voucher and release", body: "Open the code, check it works, then release the USDC. If it doesn't work, raise a dispute before the review window ends.", actions: ["release", "dispute"] })
          : set({ tone: "amber", actor: "USDC buyer", headline: "Marked delivered. Waiting for the code", body: "The USDC buyer marked the voucher delivered on-chain, so your review window is running. If the code doesn't arrive, raise a dispute before it ends.", actions: ["release", "dispute"] });
      }
      if (role === "buyer" && viewerBound) {
        return codeIn
          ? set({ tone: "iris", actor: "voucher buyer", headline: "Waiting for the voucher buyer to check your voucher", body: `When they release, or if they don't dispute before the review window ends, ${amt} is paid to you.`, actions: ["concede"] })
          : set({ tone: "amber", actor: "you", headline: "Your move: submit the voucher code", body: "You marked the voucher delivered on-chain, and the review window is running. Send the code now so the voucher buyer can check it.", actions: ["deliver", "concede"] });
      }
      return set({ tone: "iris", actor: "voucher buyer", headline: "The voucher buyer is checking the voucher", body: "The voucher was marked delivered." });
    }
    case ST.Disputed: {
      if (past) v.notes.push({ tone: "iris", text: "The arbiter didn't rule in time. The refund to the voucher buyer is sent automatically within a minute or two." });
      if (role === "spender") return set({ tone: "rose", actor: "arbiter", headline: "Under review by the arbiter", body: "Add your evidence on the dispute page. You can also end the dispute by releasing the USDC.", actions: ["openDispute", "release"] });
      if (role === "buyer" && viewerBound) return set({ tone: "rose", actor: "arbiter", headline: "Under review by the arbiter", body: "Add your evidence on the dispute page. You can also end it by giving the money back.", actions: ["openDispute", "concede"] });
      return set({ tone: "rose", actor: "arbiter", headline: "Under review by the arbiter", body: "The funds stay in escrow until the arbiter rules." });
    }
    case ST.Released:
      return role === "buyer" ? ended(v, "mint", "Completed. You were paid", `${amt} reached your wallet.`) : role === "spender" ? ended(v, "mint", "Completed. The voucher is yours", `The USDC buyer was paid ${amt}.`) : ended(v, "mint", "Completed", `The USDC buyer was paid ${amt}.`);
    case ST.Refunded:
      return role === "spender" ? ended(v, "mute", s === "cancelled" ? "Cancelled. Your USDC came back" : "Refunded. Your USDC came back", `${locked} was returned to your wallet.`) : role === "buyer" ? ended(v, "mute", "Refunded to the voucher buyer", "You were not paid for this order.") : ended(v, "mute", "Refunded", `${locked} was returned to the voucher buyer.`);
    case ST.Resolved:
      return ended(v, "mute", "The arbiter ruled", "The escrow was split by the arbiter's ruling. Nothing is locked any more.", role === "observer" ? [] : ["openDispute"]);
  }
  return set({ headline: "Unknown on-chain state", body: `The escrow reports state ${e.status}.` });
}

function ended(v: OrderView, tone: Tone, headline: string, body: string, actions: Action[] = []): OrderView {
  return Object.assign(v, { tone, headline, body, actor: "nobody", actions, deadline: null });
}

/** No chain facts: wording from the server status. Actions only where no chain fact is needed (or in mock mode, where there is no chain). */
function serverOnly(v: OrderView, req: ApiRequest, role: Role, chain: ChainInput, amt: string, locked: string, voucher: string) {
  const set = (p: Partial<OrderView>) => Object.assign(v, p);
  const mock = chain.kind === "mock";
  const list = chain.kind === "server-only";
  // In the list nothing is offered inline except cancelling an undeposited order; the page has the rest.
  const act = (a: Action[]) => (mock ? a : list ? a.filter((x) => x === "cancelNoTx") : a.filter((x) => x === "cancelNoTx" || x === "openDispute" || x === "fill"));
  const ready = v.ready === "valid";
  switch (req.status) {
    case "pending_funding":
      return role === "spender"
        ? set({ tone: "amber", actor: "you", headline: "Your move: deposit USDC to publish this order", body: `The order isn't live until ${locked} is in escrow. If you won't deposit, cancel it.`, actions: act(["cancelNoTx"]) })
        : set({ tone: "mute", actor: "voucher buyer", headline: "Not live yet", body: "The voucher buyer hasn't deposited the USDC yet." });
    case "open":
      if (role === "spender") return set({ tone: "mint", actor: "nobody", headline: "Waiting for a USDC buyer", body: `Your ${locked} is locked and the order is in the order book. Until a USDC buyer is bound on-chain you can cancel and get all of it back.`, actions: act(["cancel"]) });
      return set({ tone: "mint", actor: "nobody", headline: "This order is open", body: `Buy a ${voucher} on your best card and you receive ${amt}.`, actions: role === "observer" ? act(["fill"]) : [] });
    case "accepted":
      if (role === "spender") {
        return ready
          ? set({ tone: "amber", actor: "USDC buyer", headline: "Waiting for the USDC buyer to deliver your voucher", body: "You're ready. The USDC buyer confirms the order from their wallet, buys the voucher and hands over the code.", actions: act(["cancel"]) })
          : set({ tone: "amber", actor: "you", headline: req.ready ? "Your move: sign Ready again" : "Your move: press Ready for the USDC buyer", body: "A USDC buyer accepted your order. Ready is a free signature (no gas) that lets them bind to your order on-chain.", actions: act(["ready", "cancel"]) });
      }
      if (role === "buyer") {
        if (!ready) return set({ tone: "amber", actor: "voucher buyer", headline: req.ready ? "Waiting for the voucher buyer to press Ready again" : "Waiting for the voucher buyer to press Ready", body: "Don't buy the voucher yet. Your next step appears once they do." });
        if (mock) return set({ tone: "amber", actor: "you", headline: "Your move: buy the voucher and submit the code", body: `Buy the ${voucher}, then submit its code below to be paid ${amt}.`, actions: ["buyVoucher", "deliver"] });
        return set({ tone: "amber", actor: "you", headline: "Your move: confirm on-chain, then deliver", body: "The voucher buyer is ready. Confirm the order from your wallet first; buy the voucher only after that goes through." });
      }
      return set({ tone: "amber", actor: "USDC buyer", headline: "A USDC buyer is working on this order", body: "Nothing for you to do." });
    case "code_submitted":
      if (role === "spender") return set({ tone: "iris", actor: "you", headline: "Your move: check the voucher and release", body: "Check the voucher works, then release the USDC, or raise a dispute if it doesn't.", actions: act(["release", "dispute"]) });
      if (role === "buyer") return set({ tone: "iris", actor: "voucher buyer", headline: "Waiting for the voucher buyer to check your voucher", body: `When they release, or if they don't dispute before the review window ends, ${amt} is paid to you.` });
      return set({ tone: "iris", actor: "voucher buyer", headline: "The voucher buyer is checking the voucher", body: "The voucher was handed over." });
    case "disputed":
      return set({ tone: "rose", actor: "arbiter", headline: "Under review by the arbiter", body: "The funds stay in escrow until the arbiter rules. If nobody rules in time, they return to the voucher buyer.", actions: role === "observer" ? [] : act(["openDispute"]) });
    case "releasing":
      return set({ tone: "iris", actor: "automatic", headline: role === "buyer" ? "You're being paid" : "Paying the USDC buyer", body: `${amt} is being sent on-chain.` });
    case "refunding":
      return set({ tone: "iris", actor: "automatic", headline: role === "spender" ? "Your USDC is coming back" : "Refunding the voucher buyer", body: `${locked} is being returned on-chain.` });
    case "released":
      return ended(v, "mint", role === "buyer" ? "Completed. You were paid" : role === "spender" ? "Completed. The voucher is yours" : "Completed", role === "buyer" ? `${amt} reached your wallet.` : `The USDC buyer was paid ${amt}.`);
    case "refunded":
      return ended(v, "mute", role === "spender" ? "Refunded. Your USDC came back" : "Refunded to the voucher buyer", role === "spender" ? `${locked} was returned to your wallet.` : role === "buyer" ? "You were not paid for this order." : `${locked} was returned to the voucher buyer.`);
    case "cancelled":
      return ended(v, "mute", "Cancelled", req.fundedAt || req.escrowTxHash ? `The voucher buyer cancelled this order and ${locked} went back to them.` : "Cancelled before any USDC was locked.");
    default:
      return set({ headline: "Unknown state", body: `The order reports status "${String(req.status)}".` });
  }
}

/** Short status label for the order list. */
export const isFinalStatus = (s: ReqStatus) => FINAL.has(s);
