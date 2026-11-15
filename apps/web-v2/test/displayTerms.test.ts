import assert from "node:assert/strict";
import { test } from "node:test";
import { LAUNCH_TERMS, LIVE_DEPLOYMENT, displayTerms, durationText } from "../src/lib/displayTerms.ts";
import { parseTerms } from "../src/lib/terms.ts";

test("durationText reads like a sentence", () => {
  assert.equal(durationText(86_400), "24 hours");
  assert.equal(durationText(7_200), "2 hours");
  assert.equal(durationText(3_600), "1 hour");
  assert.equal(durationText(5_400), "90 minutes");
  assert.equal(durationText(259_200), "3 days");
  assert.equal(durationText(60), "1 minute");
  assert.equal(durationText(0), "");
});

test("without live terms the launch values are shown and marked as not live", () => {
  const d = displayTerms(null);
  assert.equal(d.live, false);
  assert.deepEqual([d.fee, d.min, d.max, d.cap, d.stake, d.review, d.fulfil], ["1%", "1", "250", "5,000", "1", "24 hours", "2 hours"]);
  assert.equal(d.locked, null);
  assert.equal(d.orderOpen, null);
  assert.equal(d.paused, false);
  assert.deepEqual([d.exampleFee, d.exampleTotal], ["1", "101"]);
});

test("live terms replace every launch value", () => {
  const terms = parseTerms({
    feeBps: 250,
    minBaseUnits: "5000000",
    maxBaseUnits: "1000000000",
    capBaseUnits: "20000000000",
    lockedBaseUnits: "1234500000",
    disputeBondBaseUnits: "0",
    reviewWindowSeconds: 172_800,
    fulfillWindowSeconds: 5_400,
    orderTtlSeconds: 259_200,
    paused: true,
  });
  assert.ok(terms);
  const d = displayTerms(terms);
  assert.equal(d.live, true);
  assert.deepEqual([d.fee, d.min, d.max, d.cap, d.locked], ["2.5%", "5", "1,000", "20,000", "1,234.50"]);
  assert.equal(d.hasStake, false);
  assert.deepEqual([d.review, d.fulfil, d.orderOpen], ["2 days", "90 minutes", "3 days"]);
  assert.equal(d.paused, true);
  assert.deepEqual([d.exampleFee, d.exampleTotal], ["2.50", "102.50"]);
});

test("launch values match the deployment record", () => {
  assert.equal(LAUNCH_TERMS.feeBps, 100);
  assert.equal(LAUNCH_TERMS.max, 250_000_000n);
  assert.equal(LAUNCH_TERMS.cap, 5_000_000_000n);
  assert.equal(LIVE_DEPLOYMENT.chainId, 5042);
  assert.match(LIVE_DEPLOYMENT.contract, /^0x[0-9a-f]{40}$/);
});
