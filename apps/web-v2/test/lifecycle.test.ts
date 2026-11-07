// Run: node --test test/lifecycle.test.ts   (Node 22.18+ strips the types itself; the module has only type imports)
import test from "node:test";
import assert from "node:assert/strict";
import { buildStages, facts, impliedRate, nextStep, roleOf, type Role } from "../src/lib/lifecycle.ts";

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
  assert.match(stage(r, "observer", "outcome").detail, /paid to the buyer/);
});

test("cancelled before funding: later stages are skipped, not pending", () => {
  const r = base({ status: "cancelled" });
  assert.equal(states(r, "spender"), "created:done funded:skipped accepted:skipped ready:skipped code:skipped outcome:done");
  assert.match(stage(r, "spender", "outcome").title, /cancelled/i);
  // a step that never happened must not describe an action ("You deposited ...")
  assert.equal(stage(r, "spender", "funded").detail, "No USDC was ever locked for this order.");
  assert.equal(stage(r, "spender", "accepted").detail, "No buyer took this order.");
  assert.equal(stage(r, "buyer", "code").detail, "No voucher was handed over.");
  assert.doesNotMatch(buildStages(r, "spender").map((s) => s.detail).join(" "), /You deposited/);
});

test("finished steps are history, not instructions", () => {
  const settled = base({ ...coded, status: "released", settledAt: T(90), releaseTxHash: "0xrel" });
  assert.equal(stage(settled, "buyer", "accepted").detail, "You took this order.");
  assert.equal(stage(settled, "buyer", "code").detail, "You submitted the code.");
  assert.equal(stage(settled, "spender", "accepted").detail, "A verified buyer took the order.");
  assert.equal(stage(settled, "spender", "code").detail, "The buyer handed over the voucher.");
  // ...but while the step is live, it still tells the person what to do
  assert.match(stage(base(accepted), "buyer", "accepted").detail, /Buy the voucher and submit its code/);
  assert.match(stage(base(coded), "spender", "code").detail, /Check it works, then confirm/);
});

test("brand shows by display name, not the raw backend id", () => {
  assert.match(stage(base(funded), "buyer", "created").detail, /a ₹10,000 amazon voucher/); // default: backend id
  assert.match(buildStages(base(funded), "buyer", "Amazon Pay")[0].detail, /a ₹10,000 Amazon Pay voucher/);
  assert.match(nextStep(base(funded), "observer", "Amazon Pay").body, /₹10,000 Amazon Pay voucher/);
});

test("cancel-and-refund while open: funded, then refunded, buyer steps skipped", () => {
  const r = base({ ...funded, status: "refunded", refundTxHash: "0xrefund", settledAt: T(3) });
  assert.equal(states(r, "spender"), "created:done funded:done accepted:skipped ready:skipped code:skipped outcome:done");
  assert.equal(stage(r, "spender", "outcome").tx, "0xrefund");
  assert.match(stage(r, "spender", "outcome").detail, /came back to you/);
  assert.match(stage(r, "observer", "outcome").detail, /returned to the spender/);
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
  assert.match(stage(r, "buyer", "dispute").detail, /^The spender disputed/);
});

test("dispute resolved by refund shows the ruling and a refund outcome", () => {
  const r = base({ ...disputed, status: "refunded", refundTxHash: "0xref", settledAt: T(50), resolution: { outcome: "refund", note: "Code was spent", by: "0xadmin", at: T(45) } });
  assert.equal(states(r, "buyer"), "created:done funded:done accepted:done ready:skipped code:done dispute:done outcome:done");
  const d = stage(r, "buyer", "dispute");
  assert.equal(d.title, "Dispute resolved");
  assert.ok(d.facts.some((f) => f.label === "Ruling" && /refunded to the spender/.test(f.value)));
  assert.ok(d.facts.some((f) => f.label === "Admin note" && f.value === "Code was spent"));
  assert.match(stage(r, "buyer", "outcome").detail, /You were not paid/);
});

test("deadlines are labelled for the viewer's role", () => {
  assert.equal(stage(base(accepted), "buyer", "accepted").deadline?.label, "Submit the code by");
  assert.equal(stage(base(accepted), "spender", "accepted").deadline?.label, "Buyer must submit the code by");
  assert.equal(stage(base(coded), "spender", "code").deadline?.label, "Confirm or dispute before");
  assert.equal(stage(base(coded), "buyer", "code").deadline?.label, "USDC auto-releases to you at");
  assert.equal(stage(base(funded), "buyer", "accepted").deadline, null); // only while accepted
});

test("next step is written from the viewer's side, with the right action", () => {
  // The spender is the one who must act once the code is in
  const sp = nextStep(base(coded), "spender");
  assert.match(sp.title, /Check the voucher/);
  assert.equal(sp.cta, "settle"); // settle or dispute, from the lifecycle
  assert.equal(sp.deadline?.at, T(80));
  // The buyer just waits
  const by = nextStep(base(coded), "buyer");
  assert.match(by.title, /Waiting for the spender/);
  assert.equal(by.cta, "none");
  // ...but must act while accepted
  // The bank link (cta "trade") only appears once the spender is ready.
  assert.match(nextStep(base(accepted), "buyer").title, /Waiting for the spender to be ready/);
  assert.equal(nextStep(base(accepted), "buyer").cta, "none");
  const readyNow = { ...accepted, ready: { validUntil: Math.floor(Date.now() / 1000) + 600 } };
  assert.match(nextStep(base(readyNow), "buyer").title, /Buy the voucher/);
  assert.equal(nextStep(base(readyNow), "buyer").cta, "trade");
  assert.match(nextStep(base(accepted), "spender").title, /Tell the buyer you're ready/);
  // Only the spender can cancel, and only before a buyer accepts
  assert.equal(nextStep(base(funded), "spender").cta, "cancel");
  assert.equal(nextStep(base(), "spender").cta, "cancel");
  assert.equal(nextStep(base(accepted), "spender").cta, "ready");
  assert.equal(nextStep(base(funded), "buyer").cta, "none");
  // An outsider is invited to fill an open order, and to nothing else
  assert.equal(nextStep(base(funded), "observer").cta, "fill");
  for (const over of [accepted, coded, disputed]) assert.notEqual(nextStep(base(over), "observer").cta, "fill");
  // Settled
  assert.match(nextStep(base({ ...coded, status: "released" }), "buyer").title, /You were paid/);
  assert.match(nextStep(base({ ...funded, status: "refunded" }), "buyer").body, /not paid/);
});

test("every status gets a next step for every role (no crashes, no empty text)", () => {
  const all = ["pending_funding", "open", "accepted", "code_submitted", "disputed", "releasing", "released", "refunding", "refunded", "cancelled"];
  for (const status of all) {
    for (const role of ROLES) {
      const r = base({ ...disputed, status });
      const n = nextStep(r, role);
      assert.ok(n.title && n.body, `${status}/${role}`);
      assert.ok(buildStages(r, role).length >= 5, `${status}/${role} stages`);
    }
  }
  assert.match(nextStep(base({ status: "mystery" }), "buyer").title, /Unknown state/); // a future status does not crash the page
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
  assert.equal(nextStep(r, "spender", "Amazon Pay", NOW).cta, "ready");
  // the buyer is told to wait, an outsider is not asked to do anything
  assert.match(buildStages(r, "buyer", "Amazon Pay", NOW).find((x) => x.key === "ready")!.detail, /Waiting for the spender/);
  assert.notEqual(nextStep(r, "buyer", "Amazon Pay", NOW).cta, "ready");
  assert.notEqual(nextStep(r, "observer", "Amazon Pay", NOW).cta, "ready");
});

test("Ready: once signed it is done, shows its validity, and moves on to waiting for the code", () => {
  const r = base({ ...accepted, ready: permit(20) });
  const st = buildStages(r, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!;
  assert.equal(st.state, "done");
  assert.equal(st.at, T(8));
  assert.equal(st.actor, SPENDER.toLowerCase());
  assert.equal(st.deadline?.label, "Permit valid for");
  assert.ok(st.facts[0].value.startsWith("Valid until"));
  assert.match(st.detail, /They can now hand over the voucher code/);
  // the current step is now the buyer's code, and the spender has nothing to press
  assert.equal(buildStages(r, "spender", "Amazon Pay", NOW).filter((x) => x.state === "current").map((x) => x.key).join(), "code");
  assert.equal(nextStep(r, "spender", "Amazon Pay", NOW).cta, "none");
  assert.match(nextStep(r, "spender", "Amazon Pay", NOW).title, /You're ready/);
  assert.match(buildStages(r, "buyer", "Amazon Pay", NOW).find((x) => x.key === "ready")!.detail, /The spender is ready/);
  assert.match(nextStep(r, "buyer", "Amazon Pay", NOW).title, /^The spender is ready/);
  assert.equal(nextStep(r, "buyer", "Amazon Pay", NOW).cta, "trade");
});

test("Ready: an expired permit asks the spender to sign again", () => {
  const r = base({ ...accepted, ready: permit(5) }); // expired 5 minutes before NOW
  const st = buildStages(r, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!;
  assert.equal(st.state, "done");
  assert.equal(st.facts[0].value, "Expired");
  assert.equal(st.tone, "amber");
  assert.equal(st.deadline, null);
  assert.match(st.detail, /Sign again/);
  const n = nextStep(r, "spender", "Amazon Pay", NOW);
  assert.equal(n.cta, "ready");
  assert.match(n.title, /Sign Ready again/);
  assert.match(buildStages(r, "buyer", "Amazon Pay", NOW).find((x) => x.key === "ready")!.detail, /Ask them to sign again/);
});

test("Ready: a missing permit never blocks the order (the buyer can still hand over the code)", () => {
  const r = base(coded); // code in, no permit was ever signed
  const st = buildStages(r, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!;
  assert.equal(st.state, "skipped");
  assert.equal(st.detail, "No Ready signal was sent for this order.");
  assert.equal(buildStages(r, "spender", "Amazon Pay", NOW).filter((x) => x.state === "current").length, 1);
  // and a permit that was signed stays on the record after the order moves on
  const signed = base({ ...coded, ready: permit(20) });
  assert.equal(buildStages(signed, "spender", "Amazon Pay", NOW).find((x) => x.key === "ready")!.detail, "You told the buyer you were ready.");
});

test("Settle or dispute is offered to the spender only, and only once the code is in", () => {
  assert.equal(nextStep(base(coded), "spender").cta, "settle");
  assert.notEqual(nextStep(base(coded), "buyer").cta, "settle");
  assert.notEqual(nextStep(base(coded), "observer").cta, "settle");
  for (const over of [funded, accepted, disputed, { ...coded, status: "released" }, { ...coded, status: "releasing" }]) {
    assert.notEqual(nextStep(base(over), "spender").cta, "settle", String((over as { status: string }).status));
  }
  assert.match(nextStep(base(coded), "spender").body, /settle .* raise a dispute/i);
});
