/**
 * What a USDC buyer can earn back from their card when they fill an order, worked out from the app's own card data
 * (cardCatalog.data.ts, generated from chatbot/data/cards.json) and the app's own reward engine (engine.ts `routesFor`).
 *
 * Plain functions, no React, so the landing page's "rewards" section shows exactly what is tested here.
 *
 * Which card routes count:
 *  - only routes the research marks verified, of kind "points" or "flat_pct" (the same rule as the saved card profiles);
 *  - not routes that work by an instant discount on the voucher price (for example InstaDeals): that is a price cut on
 *    the voucher, not a reward from the card, and the research's evidence for it is one brand's calculator.
 * Basis: a route graded OFFICIAL (read on the bank's own page or PDF) is "sourced"; a verified route with any other grade
 * (SECONDARY, "base rate assumed to apply") is "assumed".
 *
 * The card data is per card route, not per store: no route in the catalog names the stores it applies to. So the best
 * rate is the same for every store, and `storeSpecific` says so for the screen to tell the reader.
 */
import { quote, routesFor, type RewardValue } from "./engine.ts";
import { profileFor } from "./cardCatalog.ts";
import { CATALOG_DATA, MAX_VOUCHER_DENOMINATION, type RawCard, type RawRoute } from "./cardCatalog.data.ts";

export type { RewardValue };

/** Stores the order book accepts today (backend config.BRANDS), as frontend brand ids (makemytrip is "mmt" here). */
export const ORDER_BOOK_STORES: { id: string; name: string }[] = [
  { id: "amazon", name: "Amazon" },
  { id: "flipkart", name: "Flipkart" },
  { id: "myntra", name: "Myntra" },
  { id: "swiggy", name: "Swiggy" },
  { id: "zomato", name: "Zomato" },
  { id: "bigbasket", name: "BigBasket" },
  { id: "mmt", name: "MakeMyTrip" },
  { id: "blinkit", name: "Blinkit" },
];

/** The headline rate is for one voucher of the largest denomination the research assumes a portal sells (₹5,000). */
export const HEADLINE_ORDER_INR = MAX_VOUCHER_DENOMINATION;

/** Sample order sizes the reader can switch between. */
export const SAMPLE_ORDERS_INR = [5_000, 10_000, 25_000] as const;

export type Basis = "sourced" | "assumed";

export type RouteReward = {
  /** Internal route id. Never shown: the landing page names no card or issuer. */
  routeId: string;
  basis: Basis;
  /** Monthly cap on bonus (accelerated) points for this route, or null when the data has none. */
  capPts: number | null;
  /** ₹ per point used to value the reward. */
  pointValueInr: number;
  orderInr: number;
  /** Reward for this order, with the monthly cap applied (assuming none of this month's bonus is used yet). */
  rewardInr: number;
  /** The same reward if there were no cap. */
  uncappedRewardInr: number;
  /** True when the monthly cap cuts the reward at this order size. */
  capped: boolean;
  /** rewardInr as a percentage of the order. */
  ratePct: number;
  /** The research's note on the route (for example when points post). */
  note: string;
};

type Eligible = { card: RawCard; route: RawRoute; basis: Basis };

/** Routes that may be used for a reward figure (see the module comment), with their basis. */
export function eligibleRoutes(catalog: RawCard[] = CATALOG_DATA): Eligible[] {
  const out: Eligible[] = [];
  for (const card of catalog)
    for (const route of card.routes) {
      if (!route.verified || (route.kind !== "points" && route.kind !== "flat_pct") || route.discount_pct) continue;
      out.push({ card, route, basis: route.status === "OFFICIAL" ? "sourced" : "assumed" });
    }
  return out;
}

/** The reward one route pays on an order of `orderInr`, through the app's engine (per-voucher rounding, monthly cap). */
export function rewardFor(card: RawCard, route: RawRoute, orderInr: number, value: RewardValue = "travel"): RouteReward | null {
  if (!(orderInr > 0)) return null;
  const { profile } = profileFor({ ...card, routes: [route] });
  const r = routesFor(orderInr, [profile])[0];
  const free = routesFor(orderInr, [{ ...profile, bonusCap: 0 }])[0]; // bonusCap 0 means "no cap" to the engine
  if (!r || !free) return null;
  const pick = (x: typeof r) => Math.min(orderInr, value === "cash" ? x.statementInr : x.travelInr);
  const rewardInr = pick(r);
  const uncappedRewardInr = pick(free);
  return {
    routeId: route.id,
    basis: route.status === "OFFICIAL" ? "sourced" : "assumed",
    capPts: route.bonus_cap_pts ?? null,
    pointValueInr: value === "cash" ? profile.statementValue : profile.travelValue,
    orderInr,
    rewardInr,
    uncappedRewardInr,
    capped: uncappedRewardInr > rewardInr,
    ratePct: (rewardInr * 100) / orderInr,
    note: route.note ?? "",
  };
}

/**
 * The best reward any eligible route pays on this order. `only: "sourced"` (the default) considers only OFFICIAL rows;
 * `"any"` also considers assumed ones. Ties go to a sourced row. Null when nothing qualifies.
 */
export function bestReward(orderInr: number, value: RewardValue = "travel", only: Basis | "any" = "sourced", catalog: RawCard[] = CATALOG_DATA): RouteReward | null {
  let best: RouteReward | null = null;
  for (const e of eligibleRoutes(catalog)) {
    if (only !== "any" && e.basis !== only) continue;
    const r = rewardFor(e.card, e.route, orderInr, value);
    if (!r || r.rewardInr <= 0) continue;
    if (!best || r.rewardInr > best.rewardInr || (r.rewardInr === best.rewardInr && r.basis === "sourced" && best.basis !== "sourced")) best = r;
  }
  return best;
}

export type StoreBest = {
  id: string;
  name: string;
  /** Best sourced route: the figure to show. */
  best: RouteReward | null;
  /** Best route including assumed rows, for comparison (equal to `best` when no assumed row beats it). */
  bestAny: RouteReward | null;
  /** False: the catalog has no per-store data, so this is the same for every store. */
  storeSpecific: boolean;
};

/** Best reward per store at an order size. The catalog's routes name no stores, so every store gets the same routes. */
export function bestByStore(orderInr: number, value: RewardValue = "travel", stores = ORDER_BOOK_STORES, catalog: RawCard[] = CATALOG_DATA): StoreBest[] {
  const best = bestReward(orderInr, value, "sourced", catalog);
  const bestAny = bestReward(orderInr, value, "any", catalog);
  return stores.map((s) => ({ id: s.id, name: s.name, best, bestAny, storeSpecific: false }));
}

/** The headline: the highest sourced rate across the supported stores, on one ₹5,000 voucher. */
export function headlineReward(value: RewardValue = "travel", catalog: RawCard[] = CATALOG_DATA): RouteReward | null {
  let top: RouteReward | null = null;
  for (const s of bestByStore(HEADLINE_ORDER_INR, value, ORDER_BOOK_STORES, catalog)) if (s.best && (!top || s.best.ratePct > top.ratePct)) top = s.best;
  return top;
}

export type Effective = {
  /** ₹ paid on the card for the voucher. */
  paidInr: number;
  rewardInr: number;
  /** USDC the USDC buyer receives: the order's amount. The fee is paid by the voucher buyer on top, so it is not taken from this. */
  usdc: number;
  /** ₹ per USDC the order itself prices (paid ÷ USDC). */
  orderPerUsdc: number;
  /** ₹ per USDC after the rewards: (paid − reward) ÷ USDC. */
  effectivePerUsdc: number;
  /** orderPerUsdc − effectivePerUsdc = reward ÷ USDC. */
  savingPerUsdc: number;
};

/**
 * The USDC buyer's cost per USDC after card rewards, for an order of `orderInr` priced at `ratePerUsdc` ₹ per USDC.
 * USDC is the amount the order pays out, rounded to cents exactly as the app's `quote` does.
 */
export function effectiveCost(orderInr: number, ratePerUsdc: number, rewardInr: number): Effective | null {
  if (!(orderInr > 0) || !(ratePerUsdc > 0) || !(rewardInr >= 0)) return null;
  const usdc = quote(orderInr, ratePerUsdc).buyerReceives;
  if (!(usdc > 0)) return null;
  const reward = Math.min(rewardInr, orderInr);
  return {
    paidInr: orderInr,
    rewardInr: reward,
    usdc,
    orderPerUsdc: orderInr / usdc,
    effectivePerUsdc: (orderInr - reward) / usdc,
    savingPerUsdc: reward / usdc,
  };
}

export type Reference = { rate: number; kind: "live-usdc" | "live-usdt" | "snapshot"; label: string };

/**
 * The ₹/USDC reference to price the example order at: the live USDC P2P buy price, else the live USDT one, else the
 * labelled snapshot the landing page already shows while the feed is down. Null when there is nothing real to use:
 * the section then hides its rupee figures rather than invent a rate.
 */
export function pickReference(m: { live: boolean; usdcBuy?: number; usdtBuy?: number }, snapshot?: { usdtBuy: number; at: string }): Reference | null {
  const ok = (n: number | undefined): n is number => typeof n === "number" && Number.isFinite(n) && n > 0;
  const r2 = (n: number) => Math.round(n * 100) / 100;
  if (ok(m.usdcBuy)) return { rate: r2(m.usdcBuy), kind: "live-usdc", label: "Live USDC P2P buy price (₹10k)" };
  if (m.live && ok(m.usdtBuy)) return { rate: r2(m.usdtBuy), kind: "live-usdt", label: "Live USDT P2P buy price (₹10k); USDC price unavailable" };
  if (!m.live && snapshot && ok(snapshot.usdtBuy)) return { rate: r2(snapshot.usdtBuy), kind: "snapshot", label: `Example rate: USDT P2P buy snapshot from ${snapshot.at}, live feed unavailable` };
  return null;
}

/* ------------------------------------------------------------- formatting */

/** Decimal places a percentage needs (0–2), so "16.5%" stays "16.5%" while it counts up. */
export function pctDigits(n: number): number {
  const r = Math.round(n * 100) / 100;
  return Number.isInteger(r) ? 0 : Number.isInteger(r * 10) ? 1 : 2;
}

/** 16.5 -> "16.5%", 4.95 -> "4.95%", 15 -> "15%". `digits` fixes the decimals (for animation frames). */
export function fmtPct(n: number, digits = pctDigits(n)): string {
  return `${(Math.round(n * 10 ** digits) / 10 ** digits).toFixed(digits)}%`;
}

/** ₹ with Indian grouping: fmtInr(25000) -> "₹25,000", fmtInr(75.1507, 2) -> "₹75.15". */
export function fmtInr(n: number, digits = 0): string {
  return `₹${n.toLocaleString("en-IN", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
}

/** 111.11 -> "111.11". */
export function fmtUsdc(n: number): string {
  return n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** 3000 -> "3,000". */
export function fmtPts(n: number): string {
  return n.toLocaleString("en-IN");
}
