// Run: node --test test/rewards.test.ts   (Node 22.18+ strips the types itself)
import test from "node:test";
import assert from "node:assert/strict";
import {
  HEADLINE_ORDER_INR,
  ORDER_BOOK_STORES,
  bestByStore,
  bestReward,
  effectiveCost,
  eligibleRoutes,
  fmtInr,
  fmtPct,
  fmtPts,
  fmtUsdc,
  headlineReward,
  pctDigits,
  pickReference,
  rewardFor,
} from "../src/lib/rewards.ts";
import type { RawCard } from "../src/lib/cardCatalog.data.ts";

/* A small catalog so the rules are tested independently of the research data. */
const T: RawCard[] = [
  {
    id: "a",
    name: "Card A",
    issuer: "BankA",
    aliases: [],
    routes: [
      { id: "a_5x", channel: "Portal 5X", kind: "points", verified: true, status: "OFFICIAL", unit: 150, base_pts: 5, mult: 5, bonus_cap_pts: 3000 },
      { id: "a_deal", channel: "Deals", kind: "points", verified: true, status: "OFFICIAL", unit: 150, base_pts: 5, mult: 1, discount_pct: 30 },
      { id: "a_direct", channel: "Direct", kind: "points", verified: true, status: "SECONDARY", unit: 150, base_pts: 5, mult: 1 },
    ],
  },
  { id: "b", name: "Card B", issuer: "BankB", aliases: [], routes: [{ id: "b_stale", channel: "Shop", kind: "flat_pct", verified: false, status: "SECONDARY", reward_pct: 40 }] },
  { id: "c", name: "Card C", issuer: "BankC", aliases: [], routes: [{ id: "c_assumed", channel: "Any", kind: "flat_pct", verified: true, status: "SECONDARY", reward_pct: 20 }] },
  { id: "d", name: "Card D", issuer: "BankD", aliases: [], routes: [{ id: "d_none", channel: "Any", kind: "excluded", verified: true, status: "OFFICIAL" }] },
];

/* ------------------------------------------------------- which rows count */

test("only verified points / cashback rows count; unverified, excluded and instant-discount rows do not", () => {
  const ids = eligibleRoutes(T).map((e) => [e.route.id, e.basis]);
  assert.deepEqual(ids, [
    ["a_5x", "sourced"],
    ["a_direct", "assumed"],
    ["c_assumed", "assumed"],
  ]);
});

test("the headline uses only sourced rows, even when an assumed row pays more", () => {
  const sourced = bestReward(5000, "travel", "sourced", T)!;
  assert.equal(sourced.routeId, "a_5x");
  assert.equal(sourced.basis, "sourced");
  const any = bestReward(5000, "travel", "any", T)!;
  assert.equal(any.routeId, "c_assumed"); // 20% assumed beats 16.5% sourced
  assert.equal(any.basis, "assumed");
});

test("no qualifying row gives null, not 0%", () => {
  assert.equal(bestReward(5000, "travel", "sourced", [T[1], T[3]]), null);
  assert.equal(bestReward(0, "travel", "sourced", T), null);
});

/* ---------------------------------------------------- rates and the cap */

test("5X points route: 5 pts per ₹150 × 5 on one ₹5,000 voucher is 825 pts = 16.5% at ₹1/pt, 4.95% at ₹0.30/pt", () => {
  const card = T[0];
  const travel = rewardFor(card, card.routes[0], 5000, "travel")!;
  assert.equal(travel.rewardInr, 825); // floor(5000/150)=33 × 5 = 165 base, × 5 = 825
  assert.equal(travel.ratePct, 16.5);
  assert.equal(travel.capped, false);
  assert.equal(travel.capPts, 3000);
  assert.equal(travel.pointValueInr, 1);
  const cash = rewardFor(card, card.routes[0], 5000, "cash")!;
  assert.equal(cash.pointValueInr, 0.3);
  assert.ok(Math.abs(cash.rewardInr - 247.5) < 1e-9);
  assert.ok(Math.abs(cash.ratePct - 4.95) < 1e-9);
});

test("the monthly bonus cap limits a ₹25,000 order and says so", () => {
  const r = rewardFor(T[0], T[0].routes[0], 25000, "travel")!;
  // 5 vouchers × 165 base = 825; bonus 825 × 4 = 3,300, capped at 3,000 → 3,825 pts
  assert.equal(r.uncappedRewardInr, 4125);
  assert.equal(r.rewardInr, 3825);
  assert.equal(r.capped, true);
  assert.equal(r.ratePct, 15.3);
  // ₹10,000 stays under the cap: 2 × 165 = 330 base, 1,320 bonus
  const ten = rewardFor(T[0], T[0].routes[0], 10000, "travel")!;
  assert.equal(ten.rewardInr, 1650);
  assert.equal(ten.capped, false);
});

test("a flat cashback row is worth the same as cash or travel", () => {
  const c = T[2];
  assert.equal(rewardFor(c, c.routes[0], 10000, "travel")!.rewardInr, 2000);
  assert.equal(rewardFor(c, c.routes[0], 10000, "cash")!.rewardInr, 2000);
});

/* ------------------------------------------------------ the real catalog */

test("real catalog: the best sourced rate per store, its basis and cap", () => {
  const stores = bestByStore(HEADLINE_ORDER_INR, "travel");
  assert.deepEqual(
    stores.map((s) => s.id),
    ORDER_BOOK_STORES.map((s) => s.id),
  );
  for (const s of stores) {
    assert.equal(s.storeSpecific, false); // the catalog has no per-store data
    assert.equal(s.best?.basis, "sourced");
    assert.equal(s.best?.ratePct, 16.5);
    assert.equal(s.best?.capPts, 3000);
    assert.ok((s.bestAny?.ratePct ?? 0) <= 16.5);
  }
  const h = headlineReward("travel")!;
  assert.equal(h.ratePct, 16.5);
  assert.equal(h.basis, "sourced");
  assert.ok(Math.abs(headlineReward("cash")!.ratePct - 4.95) < 1e-9);
});

test("the order book's stores are the backend's brands (makemytrip is mmt in the app)", () => {
  assert.deepEqual(
    ORDER_BOOK_STORES.map((s) => s.id),
    ["amazon", "flipkart", "myntra", "swiggy", "zomato", "bigbasket", "mmt", "blinkit"],
  );
});

/* ------------------------------------------------------- effective cost */

test("effective cost: pay ₹10,000 at ₹90/USDC, earn ₹1,650 → 111.11 USDC at ₹75.15 each", () => {
  const e = effectiveCost(10000, 90, 1650)!;
  assert.equal(e.paidInr, 10000);
  assert.equal(e.usdc, 111.11); // rounded to cents like the app's quote(); no fee taken from the USDC buyer
  assert.equal(e.rewardInr, 1650);
  assert.equal(e.effectivePerUsdc, (10000 - 1650) / 111.11);
  assert.equal(fmtInr(e.effectivePerUsdc, 2), "₹75.15");
  assert.equal(fmtInr(e.orderPerUsdc, 2), "₹90.00");
  assert.equal(fmtInr(e.savingPerUsdc, 2), "₹14.85");
  assert.ok(Math.abs(e.orderPerUsdc - e.effectivePerUsdc - e.savingPerUsdc) < 1e-9);
});

test("effective cost: no reward means the order price; a reward is never more than the order; bad input is null", () => {
  const e = effectiveCost(5000, 100, 0)!;
  assert.equal(e.usdc, 50);
  assert.equal(e.effectivePerUsdc, 100);
  assert.equal(effectiveCost(5000, 100, 9000)!.effectivePerUsdc, 0);
  assert.equal(effectiveCost(5000, 0, 10), null);
  assert.equal(effectiveCost(0, 90, 10), null);
  assert.equal(effectiveCost(5000, 90, -1), null);
});

/* ------------------------------------------------------- the reference */

test("reference rate: live USDC first, then live USDT, then the labelled snapshot, else nothing", () => {
  const snap = { usdtBuy: 103.15, at: "6 Nov 2026" };
  assert.deepEqual(pickReference({ live: true, usdcBuy: 95.456, usdtBuy: 96 }, snap), { rate: 95.46, kind: "live-usdc", label: "Live USDC P2P buy price (₹10k)" });
  assert.equal(pickReference({ live: true, usdtBuy: 96.004 }, snap)?.kind, "live-usdt");
  assert.equal(pickReference({ live: true, usdtBuy: 96.004 }, snap)?.rate, 96);
  const s = pickReference({ live: false }, snap)!;
  assert.equal(s.kind, "snapshot");
  assert.equal(s.rate, 103.15);
  assert.match(s.label, /Example rate.*6 Nov 2026/);
  assert.equal(pickReference({ live: true }, snap), null); // live feed up but no price: hide, don't fall back to old data
  assert.equal(pickReference({ live: false }), null);
  assert.equal(pickReference({ live: true, usdcBuy: Number.NaN }), null);
});

/* ------------------------------------------------------------ formatting */

test("formatting", () => {
  assert.equal(fmtPct(16.5), "16.5%");
  assert.equal(fmtPct(4.95), "4.95%");
  assert.equal(fmtPct(15), "15%");
  assert.equal(fmtPct(16.500000000000004), "16.5%");
  assert.equal(fmtPct(8.234, 1), "8.2%");
  assert.equal(pctDigits(16.5), 1);
  assert.equal(pctDigits(4.95), 2);
  assert.equal(pctDigits(3), 0);
  assert.equal(fmtInr(25000), "₹25,000");
  assert.equal(fmtInr(125000), "₹1,25,000");
  assert.equal(fmtInr(75.1507, 2), "₹75.15");
  assert.equal(fmtUsdc(111.11), "111.11");
  assert.equal(fmtUsdc(263.1), "263.10");
  assert.equal(fmtPts(3000), "3,000");
});
