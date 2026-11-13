// Live rates: USD/INR forex, P2P USDT/USDC–INR (Binance, Bybit, KuCoin) and Indian spot order books
// (WazirX, CoinDCX), aggregated robustly, cached, with stale fallback, history and a signed price attestation.
//
// Fallback order for every figure: fresh cache → all sources in parallel (each with timeout, retry and a
// circuit breaker) → median of those that answered, minus outliers → if every source failed, the last good
// value marked `stale` (up to RATES_MAX_STALE_SECONDS) → otherwise 503 with the last known value attached.
import { keccak256, stringToHex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';
import { forexSources, orderbookSources, p2pSources } from './sources.js';
import { median, robustAggregate, p2pPrice, bookFill, round, toPaise } from './math.js';
import { sourceHealth } from './http.js';

export const ASSETS = ['USDT', 'USDC'];
const enabled = (all) => Object.keys(all).filter((k) => !config.RATES_SOURCES.length || config.RATES_SOURCES.includes(k));
const nowIso = () => new Date().toISOString();

// ---------------------------------------------------------------- cache with stale fallback

const cache = new Map(); // key -> { value, at, inflight }
export const clearRatesCache = () => cache.clear();

async function cached(key, ttlMs, compute) {
  const e = cache.get(key) ?? {};
  cache.set(key, e);
  if (e.value && Date.now() - e.at < ttlMs) return { ...e.value, cached: true, ageSeconds: Math.round((Date.now() - e.at) / 1000) };
  e.inflight ??= compute()
    .then((value) => { e.value = value; e.at = Date.now(); return value; })
    .finally(() => { e.inflight = null; });
  try {
    return { ...(await e.inflight), cached: false, ageSeconds: 0 };
  } catch (err) {
    const age = e.value ? (Date.now() - e.at) / 1000 : Infinity;
    if (age <= config.RATES_MAX_STALE_SECONDS) {
      return { ...e.value, cached: true, stale: true, staleReason: err.message, ageSeconds: Math.round(age) };
    }
    throw new HttpError(503, 'rates_unavailable', `No live data: ${err.message}`, e.value ? { lastKnown: e.value, ageSeconds: Math.round(age) } : undefined);
  }
}

const settle = async (names, run) =>
  Promise.all(names.map(async (name) => {
    try {
      return { name, ok: true, ...(await run(name)) };
    } catch (err) {
      return { name, ok: false, error: String(err.message).slice(0, 200) };
    }
  }));

// ---------------------------------------------------------------- forex

export function getForex() {
  return cached('forex', 60_000, async () => {
    const results = await settle(enabled(forexSources), (n) => forexSources[n]({ apiKey: config.PYTH_API_KEY }));
    const maxAge = (r) => (r.kind.startsWith('daily') ? 4 * 86_400_000 : 15 * 60_000);
    const fresh = results.filter((r) => r.ok && Date.now() - Date.parse(r.asOf) <= maxAge(r));
    if (!fresh.length) throw new Error(`all forex sources failed (${results.map((r) => r.error ?? `${r.name}: stale`).join('; ')})`);
    const agg = robustAggregate(fresh.map((r) => ({ name: r.name, value: r.rate })), 1);
    const realtime = fresh.filter((r) => r.kind.startsWith('realtime') && agg.used.includes(r.name));
    return {
      pair: 'USD/INR',
      rate: round(agg.value, 4),
      realtimeRate: realtime.length ? round(median(realtime.map((r) => r.rate)), 4) : null,
      paise: toPaise(agg.value),
      used: agg.used,
      rejected: agg.rejected,
      spreadPct: agg.spreadPct,
      sources: results.map((r) => (r.ok ? { name: r.name, ok: true, rate: round(r.rate, 4), kind: r.kind, asOf: r.asOf } : r)),
      observedAt: nowIso(),
    };
  });
}

// ---------------------------------------------------------------- P2P

export function getP2P({ asset, side, amountInr }) {
  return cached(`p2p:${asset}:${side}:${amountInr}`, config.RATES_P2P_TTL_SECONDS * 1000, async () => {
    const results = await settle(enabled(p2pSources), async (n) => {
      const { ads, totalAds } = await p2pSources[n]({ asset, side, amountInr });
      const r = p2pPrice(ads, { side, amountInr, minCompletion: config.P2P_MIN_COMPLETION, minOrders: config.P2P_MIN_ORDERS });
      if (r.price == null) throw new Error(`${n}: no ad accepts ₹${amountInr}`);
      return { ...r, totalAds };
    });
    const ok = results.filter((r) => r.ok);
    if (!ok.length) throw new Error(`all P2P sources failed (${results.map((r) => r.error).join('; ')})`);
    const agg = robustAggregate(ok.map((r) => ({ name: r.name, value: r.price })), config.RATES_OUTLIER_PCT);
    const usedBests = ok.filter((r) => agg.used.includes(r.name)).map((r) => r.best);
    return {
      asset,
      side,
      meaning: side === 'buy' ? 'INR you pay per 1 coin' : 'INR you receive per 1 coin',
      amountInr,
      price: round(agg.value, 4),
      paise: toPaise(agg.value),
      bestPrice: round(side === 'buy' ? Math.min(...usedBests) : Math.max(...usedBests), 4),
      used: agg.used,
      rejected: agg.rejected,
      spreadPct: agg.spreadPct,
      sources: results.map((r) => (r.ok ? { ...r, price: round(r.price, 4), best: round(r.best, 4) } : r)),
      observedAt: nowIso(),
    };
  });
}

// ---------------------------------------------------------------- order books

export function getBooks({ asset, amountInr }) {
  return cached(`book:${asset}:${amountInr}`, config.RATES_P2P_TTL_SECONDS * 1000, async () => {
    const results = await settle(enabled(orderbookSources), async (n) => {
      const book = await orderbookSources[n]({ asset });
      const buy = bookFill(book, { side: 'buy', amountInr });
      const sell = bookFill(book, { side: 'sell', amountInr });
      return {
        bestBid: buy.bestBid, bestAsk: buy.bestAsk, mid: round(buy.mid, 4), spreadPct: round(buy.spreadPct, 3),
        buyFill: round(buy.price, 4), sellFill: round(sell.price, 4), askDepthInr: Math.round(buy.depthInr), bidDepthInr: Math.round(sell.depthInr), asOf: book.asOf,
      };
    });
    const ok = results.filter((r) => r.ok);
    if (!ok.length) throw new Error(`all order books failed (${results.map((r) => r.error).join('; ')})`);
    const agg = (k) => robustAggregate(ok.filter((r) => r[k] != null).map((r) => ({ name: r.name, value: r[k] })), config.RATES_OUTLIER_PCT);
    const [mid, buy, sell] = [agg('mid'), agg('buyFill'), agg('sellFill')];
    return {
      asset,
      amountInr,
      mid: round(mid.value, 4),
      buy: round(buy.value, 4),
      sell: round(sell.value, 4),
      used: mid.used,
      rejected: mid.rejected,
      sources: results,
      observedAt: nowIso(),
    };
  });
}

// ---------------------------------------------------------------- summary, premiums, history

const premiumBps = (price, fx) => (price && fx ? Math.round((price / fx - 1) * 10_000) : null);
const history = [];

export async function getSummary({ amountInr = config.RATES_DEFAULT_AMOUNT_INR } = {}) {
  const forex = await getForex().catch((e) => ({ error: e.message }));
  const assets = {};
  for (const asset of ASSETS) {
    const [buy, sell, book] = await Promise.all([
      getP2P({ asset, side: 'buy', amountInr }).catch((e) => ({ error: e.message })),
      getP2P({ asset, side: 'sell', amountInr }).catch((e) => ({ error: e.message })),
      getBooks({ asset, amountInr }).catch((e) => ({ error: e.message })),
    ]);
    assets[asset] = {
      p2p: {
        buy: buy.error ? { error: buy.error } : { price: buy.price, best: buy.bestPrice, used: buy.used, stale: Boolean(buy.stale) },
        sell: sell.error ? { error: sell.error } : { price: sell.price, best: sell.bestPrice, used: sell.used, stale: Boolean(sell.stale) },
        premiumBps: { buy: premiumBps(buy.price, forex.rate), sell: premiumBps(sell.price, forex.rate) },
      },
      spot: book.error ? { error: book.error } : { mid: book.mid, buy: book.buy, sell: book.sell, used: book.used, premiumBps: premiumBps(book.mid, forex.rate), stale: Boolean(book.stale) },
    };
  }
  return {
    amountInr,
    forex: forex.error ? { error: forex.error } : { usdInr: forex.rate, realtime: forex.realtimeRate, used: forex.used, stale: Boolean(forex.stale) },
    assets,
    observedAt: nowIso(),
  };
}

export function recordHistory(snapshot) {
  history.push({
    at: snapshot.observedAt,
    usdInr: snapshot.forex.usdInr ?? null,
    ...Object.fromEntries(ASSETS.flatMap((a) => [
      [`${a}_p2pBuy`, snapshot.assets[a].p2p.buy.price ?? null],
      [`${a}_p2pSell`, snapshot.assets[a].p2p.sell.price ?? null],
      [`${a}_spotMid`, snapshot.assets[a].spot.mid ?? null],
    ])),
  });
  if (history.length > 720) history.splice(0, history.length - 720);
}
export const getHistory = (limit = 120) => history.slice(-limit);

// ---------------------------------------------------------------- signed attestation + NetPositive quote

export const PRICE_TYPES = {
  PriceAttestation: [
    { name: 'asset', type: 'string' },
    { name: 'amountInr', type: 'uint256' },
    { name: 'p2pBuyPaise', type: 'uint256' },
    { name: 'p2pSellPaise', type: 'uint256' },
    { name: 'forexPaise', type: 'uint256' },
    { name: 'sourcesHash', type: 'bytes32' },
    { name: 'observedAt', type: 'uint64' },
  ],
};
const signerKey = () => config.RATES_SIGNER_PRIVATE_KEY || config.ATTESTOR_PRIVATE_KEYS[0] || null;
export const priceDomain = () => ({ name: 'NetPositive PriceFeed', version: '1', chainId: config.ARC_CHAIN_ID });

export async function getAttestation({ asset, amountInr }) {
  const [buy, sell, fx] = await Promise.all([getP2P({ asset, side: 'buy', amountInr }), getP2P({ asset, side: 'sell', amountInr }), getForex()]);
  if (buy.stale || sell.stale || fx.stale) throw new HttpError(503, 'rates_stale', 'Refusing to sign stale prices');
  if (sell.price > buy.price) {
    // Can happen briefly on thin books; signing a crossed market would invert the pricing band.
    throw new HttpError(503, 'crossed_market', `P2P sell (${sell.price}) above buy (${buy.price}) for this size`);
  }
  const sources = { buy: buy.sources.filter((s) => s.ok).map((s) => [s.name, s.price]), sell: sell.sources.filter((s) => s.ok).map((s) => [s.name, s.price]), fx: fx.sources.filter((s) => s.ok).map((s) => [s.name, s.rate]) };
  const message = {
    asset,
    amountInr: BigInt(amountInr),
    p2pBuyPaise: BigInt(buy.paise),
    p2pSellPaise: BigInt(sell.paise),
    forexPaise: BigInt(fx.paise),
    sourcesHash: keccak256(stringToHex(JSON.stringify(sources))),
    observedAt: BigInt(Math.floor(Date.now() / 1000)),
  };
  const key = signerKey();
  const signature = key ? await privateKeyToAccount(key).signTypedData({ domain: priceDomain(), types: PRICE_TYPES, primaryType: 'PriceAttestation', message }) : null;
  return {
    attestation: Object.fromEntries(Object.entries(message).map(([k, v]) => [k, typeof v === 'bigint' ? v.toString() : v])),
    signer: key ? privateKeyToAccount(key).address : null,
    signature,
    domain: priceDomain(),
    types: PRICE_TYPES,
    sources,
  };
}

/**
 * NetPositive pricing band (docs/planning/pricing-and-auction-model.md) for a voucher of `amountInr`:
 *   seller band  xFloor = 1.01·(1+sMin)·Ps,  xCap = 1.01·(1+sMax)·Ps
 *   buyer limit  min(xCap, 0.99·Pb / (1 − r))   (r = buyer's net card reward)
 */
export async function getQuote({ asset, amountInr, rewardBps, sMinBps = 100, sMaxBps = 800 }) {
  const [buy, sell, fx] = await Promise.all([getP2P({ asset, side: 'buy', amountInr }), getP2P({ asset, side: 'sell', amountInr }), getForex()]);
  const Pb = buy.price;
  const Ps = sell.price;
  const r = rewardBps / 10_000;
  const xFloor = 1.01 * (1 + sMinBps / 10_000) * Ps;
  const xCap = 1.01 * (1 + sMaxBps / 10_000) * Ps;
  const buyerCeiling = Math.min(xCap, (0.99 * Pb) / (1 - r));
  const usdc = (x) => round((1.01 * amountInr) / x, 6);
  return {
    asset,
    amountInr,
    rewardBps,
    market: { p2pBuy: Pb, p2pSell: Ps, usdInr: fx.rate, stale: Boolean(buy.stale || sell.stale || fx.stale) },
    band: { xFloor: round(xFloor, 4), xCap: round(xCap, 4), buyerCeiling: round(buyerCeiling, 4), tradable: buyerCeiling >= xFloor },
    sellerPays: { atFloor: usdc(xFloor), atCeiling: buyerCeiling >= xFloor ? usdc(buyerCeiling) : null, note: `${asset} incl. 1% fee` },
    gains: buyerCeiling >= xFloor ? {
      sellerVsP2pPct: round((buyerCeiling / (1.01 * Ps) - 1) * 100, 3),
      buyerVsP2pPct: round((1 - (buyerCeiling * (1 - r)) / Pb) * 100, 3),
    } : null,
    observedAt: nowIso(),
  };
}

export function ratesHealth() {
  return { sources: sourceHealth(), cacheKeys: cache.size, historyPoints: history.length };
}

// ---------------------------------------------------------------- background refresh

export function startRatesRefresher() {
  if (!config.RATES_REFRESH_SECONDS) return () => {};
  const tick = () => getSummary().then(recordHistory).catch((e) => console.error('[rates]', e.message));
  tick();
  const t = setInterval(tick, config.RATES_REFRESH_SECONDS * 1000);
  t.unref();
  return () => clearInterval(t);
}
