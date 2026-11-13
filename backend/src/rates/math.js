// Pure maths for rates: robust medians, outlier rejection, ad selection for a trade size, order-book fills.
// Prices are INR per 1 USDT/USDC (or per 1 USD for forex).

export const round = (x, dp = 4) => (x == null || !Number.isFinite(x) ? null : Math.round(x * 10 ** dp) / 10 ** dp);
export const toPaise = (x) => (x == null ? null : Math.round(x * 100));

export function median(xs) {
  const v = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!v.length) return null;
  const m = Math.floor(v.length / 2);
  return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2;
}

/**
 * Cross-source aggregate: median, then drop sources more than `maxDevPct` % away from it, then median again.
 * With exactly two sources that disagree by more than that, the higher-priority one wins.
 * Returns { value, used:[names], rejected:[{name, value, devPct}], spreadPct }.
 */
export function robustAggregate(entries, maxDevPct = 3) {
  // `entries` come in priority order (most liquid source first).
  const ok = entries.filter((e) => Number.isFinite(e.value));
  if (!ok.length) return { value: null, used: [], rejected: [], spreadPct: null };
  const m0 = median(ok.map((e) => e.value));
  const used = [];
  const rejected = [];
  if (ok.length === 2 && Math.abs(ok[0].value - ok[1].value) / ok[0].value * 100 > maxDevPct) {
    // Two sources that disagree: a median can't tell which is wrong, so trust the higher-priority one.
    used.push({ ...ok[0], devPct: 0 });
    rejected.push({ ...ok[1], devPct: round(((ok[1].value - ok[0].value) / ok[0].value) * 100, 3), reason: 'disagrees with higher-priority source' });
  } else {
    for (const e of ok) {
      const devPct = ((e.value - m0) / m0) * 100;
      (Math.abs(devPct) <= maxDevPct || ok.length < 3 ? used : rejected).push({ ...e, devPct: round(devPct, 3) });
    }
  }
  const vals = used.map((e) => e.value);
  const value = median(vals);
  const spreadPct = vals.length > 1 ? round(((Math.max(...vals) - Math.min(...vals)) / value) * 100, 3) : 0;
  return { value, used: used.map((e) => e.name), rejected, spreadPct };
}

/**
 * P2P: the price you can actually get for `amountInr`.
 * side 'buy' = you pay INR for crypto (lower is better); 'sell' = you get INR (higher is better).
 * Keeps ads that accept this amount, from traders with a good record; if fewer than 2 qualify, relaxes the
 * record filter (marked `relaxed`). Price = median of the best 3 ads, so a single bait ad can't move it.
 */
export function p2pPrice(ads, { side, amountInr, minCompletion = 0.9, minOrders = 20 }) {
  const fits = ads.filter((a) => Number.isFinite(a.price) && a.price > 0 && a.minInr <= amountInr && amountInr <= a.maxInr);
  const trusted = fits.filter((a) => (a.completion == null || a.completion >= minCompletion) && (a.orders == null || a.orders >= minOrders));
  const relaxed = trusted.length < 2;
  const pool = (relaxed ? fits : trusted).sort((a, b) => (side === 'buy' ? a.price - b.price : b.price - a.price));
  if (!pool.length) return { price: null, best: null, eligible: 0, considered: ads.length, relaxed };
  const top = pool.slice(0, 3);
  return {
    price: median(top.map((a) => a.price)),
    best: pool[0].price,
    eligible: pool.length,
    considered: ads.length,
    relaxed,
    top: top.map((a) => ({ price: a.price, minInr: a.minInr, maxInr: a.maxInr, completion: a.completion, orders: a.orders, merchant: a.merchant, methods: a.methods })),
  };
}

/**
 * Order book: average price to fill `amountInr` (buy walks asks, sell walks bids), plus best bid/ask/mid/spread.
 * levels: [[price, qtyInCrypto], ...] best-first.
 */
export function bookFill({ bids, asks }, { side, amountInr }) {
  const bestBid = bids[0]?.[0] ?? null;
  const bestAsk = asks[0]?.[0] ?? null;
  const mid = bestBid && bestAsk ? (bestBid + bestAsk) / 2 : null;
  let inr = 0;
  let qty = 0;
  for (const [p, q] of side === 'buy' ? asks : bids) {
    const take = Math.min(q, (amountInr - inr) / p);
    inr += take * p;
    qty += take;
    if (inr >= amountInr - 1e-9) break;
  }
  const filled = inr >= amountInr - 1e-6;
  return {
    price: filled && qty > 0 ? inr / qty : null,
    bestBid,
    bestAsk,
    mid,
    spreadPct: mid ? ((bestAsk - bestBid) / mid) * 100 : null,
    depthInr: (side === 'buy' ? asks : bids).reduce((s, [p, q]) => s + p * q, 0),
    filled,
  };
}
