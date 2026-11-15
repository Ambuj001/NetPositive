// Run: node --test test/lifecycle.test.ts   (Node 22.18+ strips the types itself; the module has only type imports)
import test from "node:test";
import assert from "node:assert/strict";
import { buildStages, facts, impliedRate, roleOf, type Role } from "../src/lib/lifecycle.ts";

const SPENDER = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const BUYER = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
const STRANGER = "0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc";
const T = (m: number) => new Date(Date.UTC(2026, 10, 6, 9, m)).toISOString();

const base = (over: Record<string, unknown> = {}) =>
  ({
    id: "order1",
    crypto_spender: SPENDER.toLowerCase(),
    crypto_buyer: null,
    brand: "amazon",
    amountInr: 10000,
    amountUsdc: "112.22",
    amountUsdcBaseUnits: "112220000",
    escrowId: "0x" + "1".repeat(64),
    status: "pending_funding",
    escrowTxHash: null,
    releaseTxHash: null,
    refundTxHash: null,
    fulfilDeadline: null,
    reviewDeadline: null,
    createdAt: T(0),
    updatedAt: T(0),
    ...over,
  }) as never;

const funded = { status: "open", escrowTxHash: "0xfund", fundedAt: T(1) };
const accepted = { ...funded, status: "accepted", crypto_buyer: BUYER.toLowerCase(), acceptedAt: T(5), fulfilDeadline: T(35) };
const coded = { ...accepted, status: "code_submitted", codeSubmittedAt: T(20), reviewDeadline: T(80) };
const disputed = { ...coded, status: "disputed", disputedBy: SPENDER.toLowerCase(), disputedAt: T(30), disputeReason: "Already redeemed" };

const states = (r: never, role: Role) => buildStages(r, role).map((s) => `${s.key}:${s.state}`).join(" ");
const stage = (r: never, role: Role, key: string) => buildStages(r, role).find((s) => s.key === key)!;
const ROLES: Role[] = ["spender", "buyer", "observer"];

test("roleOf is case-insensitive and falls back to observer", () => {
  const r = base(accepted);
  assert.equal(roleOf(r, SPENDER), "spender"); // checksum-cased wallet vs lowercase document
  assert.equal(roleOf(r, BUYER.toLowerCase()), "buyer");
  assert.equal(roleOf(r, STRANGER), "observer");
  assert.equal(roleOf(r, null), "observer");
  assert.equal(roleOf(base(), BUYER), "observer"); // no buyer yet
});

test("a live order has exactly one current stage, a settled one has none", () => {
  for (const [name, over] of Object.entries({ pending: {}, open: funded, accepted, coded, disputed, releasing: { ...coded, status: "releasing" }, refunding: { ...funded, status: "refunding" } })) {
    for (const role of ROLES) {
      const cur = buildStages(base(over), role).filter((s) => s.state === "current");
      assert.equal(cur.length, 1, `${name}/${role}: ${states(base(over), role)}`);
    }
  }
  const finals = [{ ...coded, status: "released", settledAt: T(90), releaseTxHash: "0xrel" }, { ...funded, status: "refunded", refundTxHash: "0xref" }, { status: "cancelled" }];
  for (const over of finals) for (const role of ROLES) assert.equal(buildStages(base(over), role).filter((s) => s.state === "current").length, 0);
});

test("progress moves forward stage by stage", () => {
  assert.equal(states(base(), "spender"), "created:done funded:current accepted:upcoming ready:upcoming code:upcoming outcome:upcoming");
  assert.equal(states(base(funded), "spender"), "created:done funded:done accepted:current ready:upcoming code:upcoming outcome:upcoming");
  assert.equal(states(base(accepted), "buyer"), "created:done funded:done accepted:done ready:current code:upcoming outcome:upcoming");
  assert.equal(states(base(coded), "buyer"), "created:done funded:done accepted:done ready:skipped code:done outcome:current");
});

test("released: everything done, tx proof on the outcome, wording follows the role", () => {
  const r = base({ ...coded, status: "released", settledAt: T(90), releaseTxHash: "0xrelease" });
  assert.equal(states(r, "buyer"), "created:done funded:done accepted:done ready:skipped code:done outcome:done");
  assert.equal(stage(r, "buyer", "outcome").tx, "0xrelease");
  assert.match(stage(r, "buyer", "outcome").detail, /You received 112\.22 USDC/);
  assert.match(stage(r, "spender", "outcome").detail, /voucher is yours/);
  assert.match(stage(r, "observer", "outcome").detail, /paid to the USDC buyer/);
});

test("cancelled before funding: later stages are skipped, not pending", () => {
  const r = base({ status: "cancelled" });
  assert.equal(states(r, "spender"), "created:done funded:skipped accepted:skipped ready:skipped code:skipped outcome:done");
  assert.match(stage(r, "spender", "outcome").title, /cancelled/i);
  // a step that never happened must not describe an action ("You deposited ...")
  assert.equal(stage(r, "spender", "funded").detail, "No USDC was ever locked for this order.");
  assert.equal(stage(r, "spender", "accepted").detail, "No USDC buyer took this order.");
  assert.equal(stage(r, "buyer", "code").detail, "No voucher was handed over.");
  assert.doesNotMatch(buildStages(r, "spender").map((s) => s.detail).join(" "), /You deposited/);
});

test("finished steps are history, not instructions", () => {
  const settled = base({ ...coded, status: "released", settledAt: T(90), releaseTxHash: "0xrel" });
  assert.equal(stage(settled, "buyer", "accepted").detail, "You took this order.");
  assert.equal(stage(settled, "buyer", "code").detail, "You submitted the code.");
  assert.equal(stage(settled, "spender", "accepted").detail, "A USDC buyer took your order.");
  assert.equal(stage(settled, "spender", "code").detail, "The USDC buyer handed over your voucher.");
  // ...but while the step is live, it still tells the person what to do
  assert.match(stage(base(accepted), "buyer", "accepted").detail, /confirm it from your wallet, then buy the voucher and submit its code/);
  assert.match(stage(base(coded), "spender", "code").detail, /Check it works, then release/);
});

test("brand shows by display name, not the raw backend id", () => {
  assert.match(stage(base(funded), "buyer", "created").detail, /a ₹10,000 amazon voucher/); // default: backend id
  assert.match(buildStages(base(funded), "buyer", "Amazon Pay")[0].detail, /a ₹10,000 Amazon Pay voucher/);
});

test("cancel-and-refund while open: funded, then refunded, buyer steps skipped", () => {
  const r = base({ ...funded, status: "refunded", refundTxHash: "0xrefund", settledAt: T(3) });
  assert.equal(states(r, "spender"), "created:done funded:done accepted:skipped ready:skipped code:skipped outcome:done");
  assert.equal(stage(r, "spender", "outcome").tx, "0xrefund");
  assert.match(stage(r, "spender", "outcome").detail, /came back to you/);
  assert.match(stage(r, "observer", "outcome").detail, /returned to the voucher buyer/);
});

test("reopened after the buyer missed the deadline: back to waiting for a buyer", () => {
  const r = base({ ...funded, status: "open", crypto_buyer: null, acceptedAt: null }); // sweeper cleared the buyer
  assert.equal(facts(r).accepted, false);
  assert.equal(stage(r, "spender", "accepted").state, "current");
});

test("dispute: its own current stage with the reason; outcome waits behind it", () => {
  const r = base(disputed);
  assert.equal(states(r, "spender"), "created:done funded:done accepted:done ready:skipped code:done dispute:current outcome:upcoming");
  const d = stage(r, "spender", "dispute");
  assert.deepEqual(d.facts, [{ label: "Reason", value: "Already redeemed" }]);
  assert.match(d.detail, /^You disputed/);
  assert.match(stage(r, "buyer", "dispute").detail, /^The voucher buyer disputed/);
});

test("dispute resolved by refund shows the ruling and a refund outcome", () => {
  const r = base({ ...disputed, status: "refunded", refundTxHash: "0xref", settledAt: T(50), resolution: { outcome: "refund", note: "Code was spent", by: "0xadmin", at: T(45) } });
  assert.equal(states(r, "buyer"), "created:done funded:done accepted:done ready:skipped code:done dispute:done outcome:done");
  const d = stage(r, "buyer", "dispute");
  assert.equal(d.title, "Dispute resolved");
  assert.ok(d.facts.some((f) => f.label === "Ruling" && /refunded to the voucher buyer/.test(f.value)));
  assert.ok(d.facts.some((f) => f.label === "Arbiter note" && f.value === "Code was spent"));
  assert.match(stage(r, "buyer", "outcome").detail, /You were not paid/);
});

test("deadlines are labelled for the viewer's role", () => {
  assert.equal(stage(base(accepted), "buyer", "accepted").deadline?.label, "You deliver by");
  assert.equal(stage(base(accepted), "spender", "accepted").deadline?.label, "USDC buyer delivers by");
  assert.equal(stage(base(coded), "spender", "code").deadline?.label, "Release or dispute before");
  assert.equal(stage(base(coded), "buyer", "code").deadline?.label, "You're paid automatically from");
  assert.equal(stage(base(funded), "buyer", "accepted").deadline, null); // only while accepted
});

test("every status builds stages for every role (no crashes, no empty text)", () => {
  const all = ["pending_funding", "open", "accepted", "code_submitted", "disputed", "releasing", "released", "refunding", "refunded", "cancelled"];
  for (const status of all) {
    for (const role of ROLES) {
      const r = base({ ...disputed, status });
      const st = buildStages(r, role);
      assert.ok(st.length >= 5, `${status}/${role} stages`);
      assert.ok(st.every((x) => x.title && x.detail), `${status}/${role} text`);
    }
  }
});

test("implied rate", () => {
  assert.equal(Math.round(impliedRate({ amountInr: 10000, amountUsdc: "112.22" })! * 100) / 100, 89.11);
  assert.equal(impliedRate({ amountInr: 10000, amountUsdc: "0" }), null);
});

// ---------------------------------------------------------------- Ready permit

const NOW = Date.parse(T(10));
const permit = (validUntilMin: number) => ({ validUntil: Math.floor(Date.parse(T(validUntilMin)) / 1000), signature: "0x" + "ab".repeat(65), signedAt: T(8) });

test("Ready: the spender is asked to sign once a buyer has accepted", () => {
  const r = base(accepted);
  const st = buildStages(r, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!;
  assert.equal(st.state, "current");
  assert.match(st.detail, /free signature, no gas/);
  // the buyer is told to wait, an outsider is not asked to do anything
  assert.match(buildStages(r, "buyer", "Amazon Pay", NOW).find((x) => x.key === "ready")!.detail, /Waiting for the voucher buyer/);
});

test("Ready: once signed it is done, shows its validity, and moves on to waiting for the code", () => {
  const r = base({ ...accepted, ready: permit(20) });
  const st = buildStages(r, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!;
  assert.equal(st.state, "done");
  assert.equal(st.at, T(8));
  assert.equal(st.actor, SPENDER.toLowerCase());
  assert.equal(st.deadline?.label, "Permit valid for");
  assert.ok(st.facts[0].value.startsWith("Valid until"));
  assert.match(st.detail, /They confirm the order from their wallet, then hand over the voucher code/);
  // the current step is now the buyer's code, and the spender has nothing to press
  assert.equal(buildStages(r, "spender", "Amazon Pay", NOW).filter((x) => x.state === "current").map((x) => x.key).join(), "code");
  assert.match(buildStages(r, "buyer", "Amazon Pay", NOW).find((x) => x.key === "ready")!.detail, /The voucher buyer is ready/);
});

test("Ready: an expired permit asks the spender to sign again", () => {
  const r = base({ ...accepted, ready: permit(5) }); // expired 5 minutes before NOW
  const st = buildStages(r, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!;
  assert.equal(st.state, "done");
  assert.equal(st.facts[0].value, "Expired");
  assert.equal(st.tone, "amber");
  assert.equal(st.deadline, null);
  assert.match(st.detail, /Sign again/);
  assert.match(buildStages(r, "buyer", "Amazon Pay", NOW).find((x) => x.key === "ready")!.detail, /Ask them to press Ready again/);
});

test("Ready: a missing permit never blocks the order (the buyer can still hand over the code)", () => {
  const r = base(coded); // code in, no permit was ever signed
  const st = buildStages(r, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!;
  assert.equal(st.state, "skipped");
  assert.equal(st.detail, "No Ready signal was sent for this order.");
  assert.equal(buildStages(r, "spender", "Amazon Pay", NOW).filter((x) => x.state === "current").length, 1);
  // and a permit that was signed stays on the record after the order moves on
  const signed = base({ ...coded, ready: permit(20) });
  assert.equal(buildStages(signed, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!.detail, "You told the USDC buyer you were ready.");
});

test("amounts: the spender sees the total they locked, the buyer what they are paid", () => {
  const v2 = { amountUsdc: "100", amountUsdcBaseUnits: "100000000", feeUsdcBaseUnits: "1000000", totalUsdcBaseUnits: "101000000" };
  assert.match(stage(base({ ...funded, ...v2 }), "spender", "funded").detail, /You deposited 101\.00 USDC/);
  const refunded = base({ ...funded, ...v2, status: "refunded", refundTxHash: "0xref" });
  // A funded order the spender cancelled says the money went back; one never funded says nothing was locked.
});
