// Run: node --test test/disputeView.test.ts   (Node 22.18+ strips the types itself; the module has only type imports)
import test from "node:test";
import assert from "node:assert/strict";
import { disputerOf, hasDispute, outcomeLine, roleIn, screenFor, stakeLine } from "../src/lib/disputeView.ts";

const SPENDER = "0xAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaaAAaa";
const BUYER = "0xBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbbBBbb";
const OTHER = "0xCCccCCccCCccCCccCCccCCccCCccCCccCCccCCcc";
const now = Date.UTC(2026, 10, 7, 12, 0, 0);
const future = new Date(now + 600_000).toISOString();
const past = new Date(now - 600_000).toISOString();

const req = (over: Record<string, unknown> = {}) => ({ id: "r1", status: "code_submitted", crypto_spender: SPENDER, crypto_buyer: BUYER, reviewDeadline: future, ...over }) as never;

test("roles are matched case-insensitively and strangers have none", () => {
  assert.equal(roleIn(req(), SPENDER.toLowerCase()), "spender");
  assert.equal(roleIn(req(), BUYER.toUpperCase().replace("0X", "0x")), "buyer");
  assert.equal(roleIn(req(), OTHER), null);
  assert.equal(roleIn(req(), null), null);
  assert.equal(roleIn(req({ crypto_buyer: null }), BUYER), null);
});

test("a stranger cannot raise or read a dispute", () => {
  assert.equal(screenFor(req(), OTHER, now).kind, "none");
  assert.equal(screenFor(req({ status: "disputed" }), OTHER, now).kind, "none");
  assert.equal(screenFor(req(), undefined, now).kind, "none");
});

test("only the crypto spender can raise while the code waits for review; the buyer is told why", () => {
  assert.equal(screenFor(req(), SPENDER, now).kind, "raise");
  const buyer = screenFor(req(), BUYER, now);
  assert.equal(buyer.kind, "none");
  assert.match((buyer as { why: string }).why, /Only the voucher buyer can open a dispute/);
  assert.match((buyer as { why: string }).why, /paid automatically when the review window ends/);
});

test("nobody can raise after the review window", () => {
  const late = req({ reviewDeadline: past });
  assert.equal(screenFor(late, SPENDER, now).kind, "none");
  assert.equal(screenFor(late, BUYER, now).kind, "none");
});

test("an open or decided dispute is shown to both parties, not the raise form", () => {
  assert.equal(screenFor(req({ status: "disputed", dispute: { by: SPENDER } }), BUYER, now).kind, "view");
  assert.equal(screenFor(req({ status: "refunded", dispute: { by: SPENDER } }), SPENDER, now).kind, "view");
  assert.equal(screenFor(req({ status: "released", disputedBy: BUYER }), BUYER, now).kind, "view");
});

test("nothing to dispute before a code exists or after a clean trade", () => {
  for (const status of ["open", "accepted"]) assert.equal(screenFor(req({ status }), SPENDER, now).kind, "none");
  const done = screenFor(req({ status: "released" }), SPENDER, now);
  assert.equal(done.kind, "none");
});

test("who raised it comes from the dispute, falling back to the old field", () => {
  assert.equal(disputerOf(req({ dispute: { by: BUYER } })), BUYER);
  assert.equal(disputerOf(req({ disputedBy: SPENDER })), SPENDER);
  assert.equal(disputerOf(req()), null);
  assert.equal(hasDispute(req()), false);
  assert.equal(hasDispute(req({ status: "disputed" })), true);
});

test("stake line says where the stake is, from each person's side", () => {
  const held = req({ dispute: { by: SPENDER, bond: { status: "held" } } });
  assert.match(stakeLine(held, SPENDER), /Your stake is locked/);
  assert.match(stakeLine(held, BUYER), /other person's stake is locked/);
  const back = req({ dispute: { by: SPENDER, bond: { status: "returned" } } });
  assert.match(stakeLine(back, SPENDER), /returned to you/);
  const lost = req({ dispute: { by: SPENDER, bond: { status: "forfeited" } } });
  assert.match(stakeLine(lost, SPENDER), /went to the other person/);
  assert.match(stakeLine(lost, BUYER), /You received the stake/);
  assert.match(stakeLine(req({ dispute: { by: SPENDER, bond: { status: "none" } } }), SPENDER), /No stake was needed/);
});

test("outcome reads right for the winner and the loser, and is empty while open", () => {
  assert.equal(outcomeLine(req({ dispute: { by: SPENDER } }), SPENDER), null);
  const right = req({ dispute: { by: SPENDER }, resolution: { verdict: "disputer_right" } });
  assert.deepEqual([outcomeLine(right, SPENDER)?.good, outcomeLine(right, BUYER)?.good], [true, false]);
  assert.match(outcomeLine(right, BUYER)!.text, /strike/);
  const wrong = req({ dispute: { by: SPENDER }, resolution: { verdict: "disputer_wrong" } });
  assert.deepEqual([outcomeLine(wrong, SPENDER)?.good, outcomeLine(wrong, BUYER)?.good], [false, true]);
  assert.match(outcomeLine(wrong, SPENDER)!.text, /banned/);
  // No stake since escrow V2, so none is mentioned...
  assert.doesNotMatch(outcomeLine(wrong, BUYER)!.text, /stake/);
  assert.doesNotMatch(outcomeLine(right, SPENDER)!.text, /stake/);
  // ...except on an older dispute that had one.
  const staked = req({ dispute: { by: SPENDER, bond: { status: "forfeited" } }, resolution: { verdict: "disputer_wrong" } });
  assert.match(outcomeLine(staked, BUYER)!.text, /received the other person's stake/);
});

test("an unknown verdict shows nothing rather than guessing", () => {
  assert.equal(outcomeLine(req({ dispute: { by: SPENDER }, resolution: { verdict: "???" } }), SPENDER), null);
});
