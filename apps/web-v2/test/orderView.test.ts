// The action matrix: {server status, chain record, viewer, Ready, now} → headline, who acts, deadline, actions.
import test from "node:test";
import assert from "node:assert/strict";
import { deadlineLine, deadlineShort, deadlineUrgency, duration, orderView, readyState, type Action, type ChainInput, type Role } from "../src/lib/orderView.ts";
import type { OnchainEscrow } from "../src/lib/onchain.ts";

const SPENDER = "0x" + "aa".repeat(20);
const BUYER = "0x" + "bb".repeat(20);
const OTHER = "0x" + "cc".repeat(20);
const NOW = Date.UTC(2026, 10, 15, 12, 0);
const SEC = Math.floor(NOW / 1000);
const ROLES: Role[] = ["spender", "buyer", "observer"];
const STATUSES = ["pending_funding", "open", "accepted", "code_submitted", "disputed", "releasing", "released", "refunding", "refunded", "cancelled"] as const;

const req = (over: Record<string, unknown> = {}) =>
  ({
    id: "o1",
    crypto_spender: SPENDER,
    crypto_buyer: BUYER,
    brand: "amazon",
    amountInr: 10000,
    amountUsdc: "100",
    amountUsdcBaseUnits: "100000000",
    feeUsdcBaseUnits: "1000000",
    totalUsdcBaseUnits: "101000000",
    escrowId: "0x" + "11".repeat(32),
    status: "accepted",
    escrowTxHash: "0xfund",
    releaseTxHash: null,
    refundTxHash: null,
    fulfilDeadline: null,
    reviewDeadline: null,
    createdAt: null,
    updatedAt: null,
    ready: null,
    ...over,
  }) as never;

const esc = (over: Partial<OnchainEscrow> = {}): ChainInput => ({
  kind: "ok",
  escrow: { depositor: SPENDER, openUntil: SEC + 3600, epoch: 0, fulfiller: null, deadline: SEC + 3600, status: 1, token: "0x" + "36".repeat(20), reviewWindow: 86400, fulfillWindow: 3600, amount: 100_000_000n, fee: 1_000_000n, bond: 1_000_000n, block: null, ...over },
});
const readyOk = { validUntil: SEC + 300, epoch: 0, signature: "0x" + "ab".repeat(65), signedAt: "x" };
const view = (r: never, role: Role, chain: ChainInput, signedIn = true) => orderView({ req: r, role, chain, now: NOW, signedIn, viewer: role === "spender" ? SPENDER : role === "buyer" ? BUYER : OTHER });
const acts = (r: never, role: Role, chain: ChainInput) => view(r, role, chain).actions.slice().sort().join(",");

test("readyState: none, valid, expired, stale (epoch moved on-chain)", () => {
  assert.equal(readyState({ ready: null }, null, SEC), "none");
  assert.equal(readyState({ ready: readyOk }, { epoch: 0 }, SEC), "valid");
  assert.equal(readyState({ ready: { ...readyOk, validUntil: SEC } }, { epoch: 0 }, SEC), "expired");
  assert.equal(readyState({ ready: readyOk }, { epoch: 1 }, SEC), "stale");
  assert.equal(readyState({ ready: readyOk }, null, SEC), "valid"); // no chain: only the clock can be checked
});

test("cancel: the voucher buyer may cancel whenever the chain is Funded with nobody bound (open AND accepted)", () => {
  for (const status of ["open", "accepted", "pending_funding"]) assert.ok(view(req({ status }), "spender", esc()).actions.includes("cancel"), status);
  assert.ok(view(req({ status: "accepted", ready: readyOk }), "spender", esc()).actions.includes("cancel"));
  // Bound on-chain: no cancel, and the reason is given.
  const bound = view(req(), "spender", esc({ fulfiller: BUYER }));
  assert.ok(!bound.actions.includes("cancel"));
  assert.ok(bound.notes.some((n) => /Cancel isn't possible now/.test(n.text)));
  // Nothing deposited: cancel without a transaction.
  assert.deepEqual(view(req({ status: "pending_funding" }), "spender", esc({ status: 0 })).actions, ["cancelNoTx"]);
  // Never for the other two.
  for (const role of ["buyer", "observer"] as Role[]) assert.ok(!view(req({ status: "open" }), role, esc()).actions.some((a) => a === "cancel" || a === "cancelNoTx"));
});

test("Ready: offered while nobody is bound and there is no usable Ready; 'again' when expired or stale", () => {
  assert.equal(acts(req(), "spender", esc()), "cancel,ready");
  const expired = view(req({ ready: { ...readyOk, validUntil: SEC - 1 } }), "spender", esc());
  assert.ok(expired.actions.includes("ready"));
  assert.match(expired.headline, /sign Ready again/);
  const stale = view(req({ ready: readyOk }), "spender", esc({ epoch: 1 }));
  assert.equal(stale.ready, "stale");
  assert.ok(stale.actions.includes("ready"));
  assert.equal(acts(req({ ready: readyOk }), "spender", esc()), "cancel");
  assert.match(view(req({ ready: readyOk }), "spender", esc()).headline, /Waiting for the USDC buyer to confirm/);
});

test("bind: only for the USDC buyer, only with a valid Ready, before the order expires", () => {
  const ok = view(req({ ready: readyOk }), "buyer", esc());
  assert.deepEqual(ok.actions, ["bind"]);
  assert.equal(ok.actor, "you");
  assert.match(ok.headline, /^Your move: confirm the order on-chain/);
  assert.equal(ok.caution, "Don't buy the voucher until this confirms.");
  const none = view(req(), "buyer", esc());
  assert.deepEqual(none.actions, []);
  assert.match(none.headline, /Waiting for the voucher buyer to press Ready$/);
  const again = view(req({ ready: { ...readyOk, validUntil: SEC - 5 } }), "buyer", esc());
  assert.match(again.headline, /press Ready again/);
  assert.deepEqual(view(req({ ready: readyOk }), "buyer", esc({ epoch: 2 })).actions, []);
  // Expired on-chain: nothing, and it settles itself.
  const late = view(req({ ready: readyOk }), "buyer", esc({ openUntil: SEC - 1, deadline: SEC - 1 }));
  assert.deepEqual(late.actions, []);
  assert.ok(late.notes.some((n) => /automatically within a minute or two/.test(n.text)));
  assert.deepEqual(view(req({ ready: readyOk }), "observer", esc()).actions, []);
});

test("after binding the code form is there, with step-away; the voucher buyer can release but not cancel", () => {
  const b = view(req(), "buyer", esc({ fulfiller: BUYER }));
  assert.deepEqual(b.actions.slice().sort(), ["buyVoucher", "deliver", "unassign"]);
  assert.match(b.headline, /^Your move: buy the voucher and submit the code/);
  assert.equal(b.deliveredOnChain, false);
  assert.deepEqual(view(req(), "spender", esc({ fulfiller: BUYER })).actions, ["release"]);
  assert.match(view(req(), "spender", esc({ fulfiller: BUYER })).headline, /Waiting for the USDC buyer to deliver your voucher/);
  // An expired Ready doesn't matter once bound.
  assert.ok(view(req({ ready: { ...readyOk, validUntil: SEC - 999 } }), "buyer", esc({ fulfiller: BUYER })).actions.includes("deliver"));
});

test("delivered on-chain: the code form only sends the code; give-back appears; the voucher buyer releases or disputes", () => {
  const b = view(req({ status: "accepted" }), "buyer", esc({ fulfiller: BUYER, status: 2 }));
  assert.deepEqual(b.actions, ["deliver", "concede"]);
  assert.equal(b.deliveredOnChain, true);
  assert.match(b.headline, /submit the voucher code/);
  const waiting = view(req({ status: "code_submitted" }), "buyer", esc({ fulfiller: BUYER, status: 2 }));
  assert.deepEqual(waiting.actions, ["concede"]);
  assert.match(waiting.headline, /^Waiting for the voucher buyer to check your voucher/);
  const s = view(req({ status: "code_submitted" }), "spender", esc({ fulfiller: BUYER, status: 2 }));
  assert.deepEqual(s.actions, ["release", "dispute"]);
  assert.match(s.headline, /^Your move: check the voucher and release/);
});

test("disputed: both parties get the dispute page; release for one, give-back for the other", () => {
  assert.deepEqual(view(req({ status: "disputed" }), "spender", esc({ fulfiller: BUYER, status: 3 })).actions, ["openDispute", "release"]);
  assert.deepEqual(view(req({ status: "disputed" }), "buyer", esc({ fulfiller: BUYER, status: 3 })).actions, ["openDispute", "concede"]);
  assert.deepEqual(view(req({ status: "disputed" }), "observer", esc({ fulfiller: BUYER, status: 3 })).actions, []);
});

test("timeouts on-chain say the keeper settles it within a minute or two", () => {
  const funded = view(req(), "spender", esc({ fulfiller: BUYER, deadline: SEC - 10 }));
  assert.ok(funded.notes.some((n) => /refund to the voucher buyer is sent automatically within a minute or two/.test(n.text)));
  assert.ok(!view(req(), "buyer", esc({ fulfiller: BUYER, deadline: SEC - 10 })).actions.includes("deliver"));
  const review = view(req({ status: "code_submitted" }), "buyer", esc({ fulfiller: BUYER, status: 2, deadline: SEC - 10 }));
  assert.ok(review.notes.some((n) => /USDC buyer is paid automatically within a minute or two/.test(n.text)));
  assert.match(review.headline, /You're being paid/);
});

test("server and chain disagree: the chain decides, and the page says the server is catching up", () => {
  const v = view(req({ status: "accepted" }), "spender", esc({ fulfiller: BUYER, status: 4 }));
  assert.equal(v.serverBehind, true);
  assert.ok(v.notes.some((n) => /catching up/.test(n.text)));
  assert.deepEqual(v.actions, []);
  assert.match(v.headline, /Completed/);
  const d = view(req({ status: "accepted" }), "spender", esc({ fulfiller: BUYER, status: 2 }));
  assert.deepEqual(d.actions, ["release", "dispute"]); // the review window is running even though the server hasn't seen the code
  assert.equal(view(req({ status: "accepted" }), "spender", esc()).serverBehind, false);
});

test("a chain record that contradicts the order stops everything", () => {
  for (const bad of [{ amount: 1n }, { depositor: OTHER }, { fulfiller: OTHER }]) {
    for (const role of ROLES) {
      const v = view(req(), role, esc(bad));
      assert.ok(v.stop, Object.keys(bad).join());
      assert.deepEqual(v.actions, []);
      assert.match(v.headline, /^Stop/);
    }
  }
});

test("without a chain reading only chain-free actions are offered; the list (server-only) offers only cancel-without-deposit", () => {
  const unknown: ChainInput = { kind: "unknown" };
  assert.deepEqual(view(req({ ready: readyOk }), "buyer", unknown).actions, []);
  assert.deepEqual(view(req({ status: "code_submitted" }), "spender", unknown).actions, []);
  assert.deepEqual(view(req({ status: "pending_funding" }), "spender", unknown).actions, ["cancelNoTx"]);
  assert.deepEqual(view(req({ status: "disputed" }), "buyer", unknown).actions, ["openDispute"]);
  assert.deepEqual(view(req({ status: "open", crypto_buyer: null }), "observer", unknown).actions, ["fill"]);
  assert.deepEqual(view(req({ status: "open" }), "spender", { kind: "server-only" }).actions, []);
  // Mock (development server): the server's word stands in for the chain.
  assert.deepEqual(view(req({ ready: readyOk }), "buyer", { kind: "mock" }).actions, ["buyVoucher", "deliver"]);
  assert.deepEqual(view(req({ status: "code_submitted" }), "spender", { kind: "mock" }).actions, ["release", "dispute"]);
});

test("the whole matrix: every status × chain state × viewer gives text, and actions only for the right person", () => {
  const chains: Record<string, ChainInput> = {
    none: esc({ status: 0 }),
    openUnassigned: esc(),
    openAssigned: esc({ fulfiller: BUYER }),
    delivered: esc({ fulfiller: BUYER, status: 2 }),
    disputed: esc({ fulfiller: BUYER, status: 3 }),
    released: esc({ fulfiller: BUYER, status: 4 }),
    refunded: esc({ status: 5 }),
    resolved: esc({ fulfiller: BUYER, status: 6 }),
    unknown: { kind: "unknown" },
    list: { kind: "server-only" },
    mock: { kind: "mock" },
  };
  const SPENDER_ONLY: Action[] = ["cancel", "cancelNoTx", "ready", "release", "dispute"];
  const BUYER_ONLY: Action[] = ["bind", "buyVoucher", "deliver", "unassign", "concede"];
  for (const status of STATUSES)
    for (const [name, chain] of Object.entries(chains))
      for (const role of ROLES)
        for (const ready of [null, readyOk]) {
          const v = view(req({ status, ready }), role, chain);
          const where = `${status}/${name}/${role}`;
          assert.ok(v.headline.length > 3 && v.body.length > 3, where);
          if (role !== "spender") assert.ok(!v.actions.some((a) => SPENDER_ONLY.includes(a)), `${where}: ${v.actions}`);
          if (role !== "buyer") assert.ok(!v.actions.some((a) => BUYER_ONLY.includes(a)), `${where}: ${v.actions}`);
          if (role === "observer") assert.ok(v.notes.some((n) => /read-only|guest|not part of this order yet/.test(n.text)), where);
          // Never "buyer" or "spender" or "seller" on its own.
          for (const text of [v.headline, v.body, v.caution ?? "", ...v.notes.map((n) => n.text)]) assert.doesNotMatch(text, /\b(?<!(USDC|voucher) )(buyer|spender|seller)\b/i, `${where}: ${text}`);
          // Ended on-chain: nothing to do but maybe read the dispute.
          if (name === "released" || name === "refunded") assert.deepEqual(v.actions, [], where);
        }
});

test("wording follows the viewer: 'Your move' only for whoever has to act", () => {
  const b = view(req({ ready: readyOk }), "buyer", esc());
  assert.equal(b.actor, "you");
  const s = view(req({ ready: readyOk }), "spender", esc());
  assert.equal(s.actor, "USDC buyer");
  assert.doesNotMatch(s.headline, /Your move/);
  const o = view(req({ ready: readyOk }), "observer", esc());
  assert.doesNotMatch(o.headline, /\byou\b/i);
});

test("sign-in is asked for only when an offered step needs the server", () => {
  assert.equal(orderView({ req: req(), role: "spender", chain: esc(), now: NOW, signedIn: false }).needsSignIn, true); // Ready, cancel
  assert.equal(orderView({ req: req({ ready: readyOk }), role: "buyer", chain: esc(), now: NOW, signedIn: false }).needsSignIn, false); // bind is wallet-only
  assert.equal(orderView({ req: req(), role: "buyer", chain: esc({ fulfiller: BUYER }), now: NOW, signedIn: false }).needsSignIn, true); // code goes to the server
  assert.equal(orderView({ req: req(), role: "observer", chain: esc(), now: NOW, signedIn: false }).needsSignIn, false);
});

test("deadline line: whose deadline, the time left, and what happens after; on-chain when read", () => {
  const fulfil = view(req(), "buyer", esc({ fulfiller: BUYER, deadline: SEC + 6720 })).deadline!;
  assert.equal(fulfil.source, "chain");
  assert.equal(deadlineLine(fulfil, "buyer", NOW), "You have 1 h 52 m to deliver. After that the USDC goes back to the voucher buyer.");
  assert.equal(deadlineLine(fulfil, "spender", NOW), "The USDC buyer has 1 h 52 m to deliver. After that your USDC comes back to you.");
  const review = view(req({ status: "code_submitted" }), "spender", esc({ fulfiller: BUYER, status: 2, deadline: SEC + 600 })).deadline!;
  assert.match(deadlineLine(review, "spender", NOW), /^You have 10 m to check the voucher and release or dispute\. After that the USDC buyer is paid automatically\./);
  assert.match(deadlineLine(review, "buyer", NOW + 700_000), /You are paid automatically within a minute or two/);
  // Without the chain, the server's deadline is used and says so.
  const s = orderView({ req: req({ fulfilDeadline: new Date(NOW + 60_000).toISOString() }), role: "buyer", chain: { kind: "server-only" }, now: NOW }).deadline!;
  assert.equal(s.source, "server");
  assert.match(deadlineLine(s, "buyer", NOW), /^You have 1 m to deliver/);
  assert.equal(duration(45), "45 s");
  assert.equal(duration(2 * 86400 + 3 * 3600), "2 d 3 h");
});

test("order list headlines name the viewer, never a third-person 'buyer'", () => {
  const list: ChainInput = { kind: "server-only" };
  const v = orderView({ req: req({ ready: readyOk, fulfilDeadline: new Date(NOW + 3600_000).toISOString() }), role: "buyer", chain: list, now: NOW });
  assert.match(v.headline, /^Your move/);
  assert.match(deadlineLine(v.deadline!, "buyer", NOW), /^You have 1 h 00 m to deliver/);
  assert.match(orderView({ req: req({ ready: readyOk }), role: "spender", chain: list, now: NOW }).headline, /Waiting for the USDC buyer to deliver your voucher/);
});

test("short deadline: a few words next to the headline, loud only in the last 15 minutes", () => {
  const open = { phase: "open" as const, at: SEC + 2 * 86400 + 23 * 3600, source: "chain" as const };
  assert.equal(deadlineShort(open, "buyer", NOW), "Closes in 2 d 23 h");
  assert.equal(deadlineShort(open, "spender", NOW), "Open for 2 d 23 h");
  assert.equal(deadlineUrgency(open, NOW), "calm");
  const fulfil = { phase: "fulfil" as const, at: SEC + 600, source: "chain" as const };
  assert.equal(deadlineShort(fulfil, "buyer", NOW), "Deliver within 10 m");
  assert.equal(deadlineUrgency(fulfil, NOW), "soon");
  assert.equal(deadlineShort(fulfil, "buyer", NOW + 700_000), "Delivery time is up");
  assert.equal(deadlineUrgency(fulfil, NOW + 700_000), "over");
});

test("the main card carries at most one caution, and the USDC buyer is told not to buy before binding", () => {
  assert.equal(view(req(), "buyer", esc()).caution, "Don't buy the voucher yet.");
  assert.equal(view(req({ ready: readyOk }), "spender", esc()).caution, null);
  assert.equal(view(req(), "buyer", esc({ fulfiller: BUYER })).caution, null);
});
