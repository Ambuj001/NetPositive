import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_FEE_BPS, checkAmount, feeOn, feePercent, limitsLine, parseTerms, retryAfterSeconds, serverErrorText, toBaseUnits, usdcShort } from "../src/lib/terms.ts";
import { quote } from "../src/lib/engine.ts";
import { stakeNotice } from "../src/lib/disputeView.ts";
import { CHATBOT_ENABLED, CHATBOT_URL, chatbotHeaders, resolveChatbotUrl } from "../src/lib/chatbot.ts";

const RAW = {
  version: 2,
  mode: "chain",
  chainId: 5042,
  contract: "0x14ED5880d4c2cbf0459f5ab019651aaa0f168ea2",
  token: "0x3600000000000000000000000000000000000000",
  feeBps: 50,
  disputeBondBaseUnits: "2000000",
  minBaseUnits: "1000000",
  maxBaseUnits: "500000000",
  capBaseUnits: "10000000000",
  lockedBaseUnits: "9990000000",
  orderTtlSeconds: 86400,
  reviewWindowSeconds: 3600,
  fulfillWindowSeconds: 1800,
  paused: false,
};

test("parseTerms: reads the server's answer; rejects anything that isn't terms", () => {
  const t = parseTerms(RAW)!;
  assert.equal(t.feeBps, 50);
  assert.equal(t.contract, "0x14ed5880d4c2cbf0459f5ab019651aaa0f168ea2");
  assert.equal(t.disputeBond, 2_000_000n);
  assert.equal(t.min, 1_000_000n);
  assert.equal(t.max, 500_000_000n);
  assert.equal(t.cap - t.locked, 10_000_000n);
  assert.equal(t.paused, false);
  assert.equal(parseTerms({ ...RAW, mode: "mock", contract: null })!.contract, null);
  assert.equal(parseTerms(null), null);
  assert.equal(parseTerms({ error: "not_found" }), null);
  assert.equal(parseTerms({ ...RAW, feeBps: 5000 }), null);
  assert.equal(parseTerms({ ...RAW, minBaseUnits: "1.5" }), null);
});

test("fee: the contract's sum, and the label", () => {
  assert.equal(feeOn(5_370_000n, 100), 53_700n);
  assert.equal(feeOn(999n, 100), 9n); // rounds down, like the contract
  assert.equal(feePercent(100), "1%");
  assert.equal(feePercent(50), "0.5%");
  assert.equal(feePercent(125), "1.25%");
  assert.equal(feePercent(0), "0%");
  assert.equal(DEFAULT_FEE_BPS, 100);
});

test("quote: the fee follows feeBps and defaults to 1%", () => {
  assert.deepEqual([quote(10000, 90).buyerReceives, quote(10000, 90).fee, quote(10000, 90).sellerLocks], [111.11, 1.11, 112.22]);
  assert.equal(quote(10000, 90, 50).fee, 0.56);
  assert.equal(quote(10000, 90, 0).sellerLocks, 111.11);
  assert.equal(quote(10000, 0).sellerLocks, 0); // no rate, no price
});

test("checkAmount: limits, pause and the launch cap, before any wallet prompt", () => {
  const t = parseTerms(RAW)!;
  assert.deepEqual(checkAmount(t, 5_000_000n), { ok: true });
  const low = checkAmount(t, 999_999n);
  assert.ok(!low.ok && low.reason === "below_min" && /smallest order is 1 USDC/.test(low.text));
  const high = checkAmount(t, 500_000_001n);
  assert.ok(!high.ok && high.reason === "above_max" && /largest order is 500 USDC/.test(high.text));
  // 10 USDC of room: 9.95 + 0.5% fee fits, 9.96 does not.
  assert.deepEqual(checkAmount(t, 9_950_000n), { ok: true });
  const cap = checkAmount(t, 9_960_000n);
  assert.ok(!cap.ok && cap.reason === "over_cap" && /only 10 USDC can still be locked/.test(cap.text));
  const full = checkAmount({ ...t, locked: t.cap }, 2_000_000n);
  assert.ok(!full.ok && full.reason === "over_cap" && /reached its launch cap/.test(full.text));
  const paused = checkAmount({ ...t, paused: true }, 5_000_000n);
  assert.ok(!paused.ok && paused.reason === "paused" && /paused/.test(paused.text));
  assert.equal(limitsLine(t), "Orders from 1 to 500 USDC.");
});

test("amounts as text and base units", () => {
  assert.equal(usdcShort(5_000_000n), "5");
  assert.equal(usdcShort(5_370_000n), "5.37");
  assert.equal(usdcShort(5_500_000n), "5.50");
  assert.equal(usdcShort(1n), "0.000001");
  assert.equal(usdcShort(1_234_000_000n), "1,234");
  assert.equal(toBaseUnits(5.37), 5_370_000n);
  assert.equal(toBaseUnits(0), 0n);
  assert.equal(toBaseUnits(NaN), 0n);
});

test("server errors: a rate outside the band, and too many requests", () => {
  const rate = serverErrorText({ status: 400, code: "rate_out_of_range", details: { impliedRate: 10000, marketRate: 94.02, maxDeviationPct: 15 } })!;
  assert.match(rate, /prices 1 USDC at ₹10000\.00/);
  assert.match(rate, /market rate is about ₹94\.02/);
  assert.match(rate, /within 15% of it \(₹79\.92 to ₹108\.12\)/);
  assert.match(serverErrorText({ code: "rate_out_of_range" })!, /too far from the market rate/);
  assert.equal(serverErrorText({ status: 429, code: "rate_limited", details: { retryAfterSeconds: 12 } }), "Too many requests. Try again in 12 seconds.");
  assert.equal(serverErrorText({ status: 429, code: "rate_limited", details: { retryAfterSeconds: 1 } }), "Too many requests. Try again in 1 second.");
  assert.equal(serverErrorText({ status: 429 }), "Too many requests. Wait a moment and try again.");
  assert.equal(serverErrorText({ status: 400, code: "invalid_body" }), null);
  assert.equal(serverErrorText(new Error("x")), null);
});

test("Retry-After: seconds or a date", () => {
  assert.equal(retryAfterSeconds("30"), 30);
  assert.equal(retryAfterSeconds("0.4"), 1);
  assert.equal(retryAfterSeconds("Wed, 21 Oct 2026 07:28:10 GMT", Date.parse("Wed, 21 Oct 2026 07:28:00 GMT")), 10);
  assert.equal(retryAfterSeconds(null), null);
  assert.equal(retryAfterSeconds("soon"), null);
});

test("dispute stake notice", () => {
  assert.equal(stakeNotice(2_000_000n, usdcShort), "You lock 2 USDC to open a dispute. It is returned unless the dispute is decided against you.");
  assert.equal(stakeNotice(0n, usdcShort), "No stake is needed for this order.");
  assert.match(stakeNotice(null, usdcShort), /may lock a dispute stake/);
});

test("chatbot: sends the sign-in token, and has no default address outside development", () => {
  assert.deepEqual(chatbotHeaders(true, "jwt.abc"), { "Content-Type": "application/json", Authorization: "Bearer jwt.abc" });
  assert.deepEqual(chatbotHeaders(false, "jwt.abc"), { Authorization: "Bearer jwt.abc" });
  assert.deepEqual(chatbotHeaders(true, null), { "Content-Type": "application/json" });
  assert.equal(resolveChatbotUrl("https://bot.example/", false), "https://bot.example");
  assert.equal(resolveChatbotUrl("", true), "http://127.0.0.1:8787");
  assert.equal(resolveChatbotUrl(undefined, false), "");
  // Node tests run like a production build without the variable: off.
  assert.equal(CHATBOT_URL, "");
  assert.equal(CHATBOT_ENABLED, false);
});
