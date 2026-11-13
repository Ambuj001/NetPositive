// Rates API tests with REAL responses captured from the live sources on 6 Nov 2026 ~22:00 UTC
// (prices, limits and trader stats as returned; lists trimmed). Network is replaced by a fake fetch, so the
// tests are deterministic; `npm run rates:live` checks the same code against the live APIs.
//   npm run test:rates
import assert from 'node:assert/strict';
import { recoverTypedDataAddress } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const signerKey = generatePrivateKey();
Object.assign(process.env, {
  NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(48), VOUCHER_ENC_KEY: 'ab'.repeat(32), FIREBASE_PROJECT_ID: 'demo-netpositive',
  FIRESTORE_EMULATOR_HOST: '127.0.0.1:8085', WORLD_ID_APP_ID: 'app_test', WORLD_ID_MOCK: 'true', ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0', RATES_REFRESH_SECONDS: '0', RATES_SIGNER_PRIVATE_KEY: signerKey, RATES_MAX_STALE_SECONDS: '900',
});
const { setFetch, resetBreakers, sourceHealth } = await import('../src/rates/http.js');
const { p2pPrice, bookFill, robustAggregate, median } = await import('../src/rates/math.js');
const { p2pSources } = await import('../src/rates/sources.js');
const svc = await import('../src/rates/service.js');
const { createApp } = await import('../src/app.js');

// ---------------------------------------------------------------- real captures
const bAd = (price, tradableQuantity, min, dynMax, max, orders, rate, userType, methods) => ({
  adv: { price, tradableQuantity, minSingleTransAmount: min, dynamicMaxSingleTransAmount: dynMax, maxSingleTransAmount: max, tradeMethods: methods.map((identifier) => ({ identifier })) },
  advertiser: { monthOrderCount: orders, monthFinishRate: rate, userType },
});
const BINANCE = {
  USDT_BUY: [ // ads selling USDT (you buy), cheapest first
    bAd('102.95', '658.27', '5000', '67769', '200000', 32, 1, 'user', ['UPI', 'IMPS']),
    bAd('102.99', '7278.82', '25000', '749646', '37500000', 183, 0.984, 'merchant', ['IMPS', 'UPI']),
    bAd('103.00', '11.50', '200', '1184', '1187', 1, 1, 'user', ['IMPS', 'UPI']),
    bAd('103.48', '427.42', '200', '401', '401', 8504, 1, 'user', ['UPIQRCode']),
    bAd('103.50', '278.24', '200', '450', '450', 17071, 1, 'merchant', ['UPIQRCode']),
    bAd('103.80', '4.99', '200', '518', '2000000', 58, 1, 'user', ['DigitaleRupee']),
    bAd('103.85', '99.85', '4999', '10000', '10000', 704, 0.976, 'user', ['DigitaleRupee']),
    bAd('103.90', '228.73', '200', '300', '300', 1036, 1, 'user', ['UPIQRCode']),
  ],
  USDT_SELL: [ // ads buying USDT (you sell), best first
    bAd('103.90', '200.00', '400', '1000', '1000', 589, 1, 'merchant', ['BankIndia', 'IMPS', 'UPI']),
    bAd('103.74', '10000.00', '200', '1037400', '2000000', 10, 1, 'user', ['IMPS', 'GPay']),
    bAd('103.50', '50966.17', '1000000', '2000000', '2000000', 51, 0.981, 'user', ['BankIndia']),
    bAd('103.21', '1000.00', '200', '250', '250', 20, 1, 'user', ['Paytm', 'UPI']),
    bAd('103.01', '8400.00', '49500', '865284', '2000000', 1, 0.5, 'user', ['IMPS']),
    bAd('102.97', '5000.00', '70000', '500000', '500000', 23, 0.794, 'user', ['IMPS']),
    bAd('102.95', '290.00', '25000', '29000', '29000', 28, 0.849, 'user', ['DigitaleRupee']),
  ],
  USDC_BUY: [
    bAd('105.99', '3.71852357', '200', '394', '599', 66, 0.869, 'user', ['UPI']),
    bAd('106.99', '998.50224663', '200', '2000', '2000', 1744, 1, 'user', ['UPIQRCode']),
    bAd('107.35', '252.65430074', '3800', '4500', '4500', 155, 0.951, 'merchant', ['UPI']),
    bAd('107.99', '848.52745372', '1000', '20000', '20000', 259, 0.993, 'user', ['UPI', 'IMPS']),
    bAd('108.05', '383.41484141', '900', '30000', '30000', 534, 0.929, 'merchant', ['DigitaleRupee']),
  ],
  USDC_SELL: [
    bAd('102.95', '65.38142578', '1000', '6731', '2000000', 96, 0.951, 'user', ['UPI']),
    bAd('102.54', '100.00000000', '2000', '6000', '6000', 136, 0.815, 'user', ['UPI']),
    bAd('102.12', '7345.06971901', '10000', '30000', '30000', 292, 0.994, 'user', ['UPI']),
    bAd('102.10', '672.12490953', '2000', '10000', '10000', 775, 0.989, 'user', ['UPI']),
    bAd('102.01', '555.00000000', '5000', '56615', '100000', 259, 0.993, 'user', ['UPI']),
  ],
};
// Bybit: first ad of each side is the real one; the others carry the real prices from the same capture
// (their limits weren't captured, so they're set wide enough for ₹10,000 here).
const yAd = (price, qty, min, max, n, rate, extra = {}) => ({ price, lastQuantity: qty, quantity: qty, minAmount: min, maxAmount: max, recentOrderNum: n, recentExecuteRate: rate, authStatus: 2, userType: 'PERSONAL', payments: ['82'], ...extra });
const BYBIT = {
  USDT_BUY: [yAd('90.12', '1.5', '100.00', '100.00', 5, 100), yAd('101.89', '900', '1000', '50000', 140, 98), yAd('102.89', '800', '1000', '60000', 220, 99), yAd('103.00', '600', '500', '40000', 75, 97), yAd('103.00', '2000', '5000', '200000', 410, 99)],
  USDT_SELL: [yAd('107.99', '20000', '1080000.00', '2159800.00', 21, 100), yAd('102.41', '500', '1000', '50000', 64, 96), yAd('102.11', '700', '1000', '70000', 120, 98), yAd('102.10', '900', '2000', '90000', 305, 99), yAd('101.80', '1000', '1000', '100000', 77, 95)],
};
// KuCoin: real first ads; KuCoin INR P2P is thin and expensive, so it should be rejected as an outlier.
const kAd = (floatPrice, bal, min, max, side) => ({ floatPrice, currencyBalanceQuantity: bal, limitMinQuote: min, limitMaxQuote: max, side, currency: 'USDT', legal: 'INR', adPayTypes: [{ payTypeCode: 'UPI' }] });
const KUCOIN = {
  SELL: [kAd('111.5', '146.131045', '2000', '30000', 'SELL'), kAd('104', '400', '1000', '40000', 'SELL'), kAd('107', '300', '1000', '30000', 'SELL')],
  BUY: [kAd('101.6', '47779.866138', '30000', '30001', 'BUY'), kAd('100', '500', '1000', '45000', 'BUY'), kAd('99.02', '800', '2000', '70000', 'BUY')],
};
const WAZIRX_USDT = { timestamp: 1794002420580, asks: [['99.99', '1685.35'], ['100.0', '1250.39'], ['100.01', '3409.81'], ['100.02', '100.0'], ['100.05', '577.43']], bids: [['99.61', '539.34'], ['99.6', '1.0'], ['99.21', '1212.51'], ['99.2', '2257.91'], ['99.12', '150.0']] };
const COINDCX_USDT = { timestamp: 1794002430427, asks: { '99.7700000000': '1.890000', '99.7900000000': '1.760000', '99.9700000000': '6372.720000' }, bids: { '99.3700000000': '2498.183057', '99.3300000000': '3.590000', '99.3000000000': '1179.540000' } };
const COINDCX_USDC = { timestamp: 1794002448131, asks: { '99.6939100000': '500.000000' }, bids: { '98.9000100000': '1007.000000' } };
const today = new Date().toISOString().slice(0, 10);

// ---------------------------------------------------------------- fake network
let down = new Set();
let calls = [];
setFetch(async (url, opts = {}) => {
  const u = new URL(url);
  const host = u.hostname;
  calls.push(host);
  const name = { 'api.coinbase.com': 'coinbase', 'api.frankfurter.dev': 'frankfurter', 'open.er-api.com': 'erapi', 'api.wazirx.com': 'wazirx', 'public.coindcx.com': 'coindcx', 'p2p.binance.com': 'binance', 'api2.bybit.com': 'bybit', 'www.kucoin.com': 'kucoin' }[host];
  if (down.has(name)) return { ok: false, status: 503, json: async () => ({}) };
  const body = opts.body ? JSON.parse(opts.body) : null;
  const json = (() => {
    switch (name) {
      case 'coinbase': return { data: { currency: 'USD', rates: { INR: '94.0152823333333333', USDT: '1.001401962747847' } } };
      case 'frankfurter': return { amount: 1.0, base: 'USD', date: today, rates: { INR: 93.92 } };
      case 'erapi': return { result: 'success', provider: 'https://www.exchangerate-api.com', time_last_update_unix: Math.floor(Date.now() / 1000) - 3600, base_code: 'USD', rates: { INR: 94.537031 } };
      case 'wazirx': return u.searchParams.get('symbol') === 'usdtinr' ? WAZIRX_USDT : { message: 'Invalid symbol', code: 1999 };
      case 'coindcx': return u.searchParams.get('pair') === 'I-USDT_INR' ? COINDCX_USDT : COINDCX_USDC;
      case 'binance': return { code: '000000', success: true, total: 318, data: BINANCE[`${body.asset}_${body.tradeType}`] };
      case 'bybit': return body.tokenId === 'USDT' ? { ret_code: 0, ret_msg: 'SUCCESS', result: { count: 79, items: BYBIT[body.side === '1' ? 'USDT_BUY' : 'USDT_SELL'] } } : { ret_code: 0, ret_msg: 'SUCCESS', result: { count: 0, items: [] } };
      case 'kucoin': return u.searchParams.get('currency') === 'USDT' ? { success: true, code: '200', totalNum: 20, items: KUCOIN[u.searchParams.get('side')] } : { success: true, items: [] };
      default: throw new Error(`unexpected ${url}`);
    }
  })();
  if (name === 'wazirx' && json.code) return { ok: false, status: 400, json: async () => json };
  return { ok: true, status: 200, json: async () => json };
});

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const get = async (p) => { const r = await fetch(base + p); return { status: r.status, body: await r.json() }; };
const ok = (r) => { assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body; };
const step = (s) => console.log(`  ✓ ${s}`);
const reset = () => { svc.clearRatesCache(); resetBreakers(); down = new Set(); };

try {
  // ---------------------------------------------------------------- maths on the real ads
  const binBuy = (await p2pSources.binance({ asset: 'USDT', side: 'buy', amountInr: 10_000 })).ads;
  const r1 = p2pPrice(binBuy, { side: 'buy', amountInr: 10_000, minCompletion: 0.9, minOrders: 20 });
  // Only 102.95 (₹5k–67,769, 32 orders) and 103.85 (₹4,999–10k, 704 orders) take ₹10,000 from good traders.
  assert.deepEqual(r1.top.map((a) => a.price), [102.95, 103.85]);
  assert.equal(r1.price, 103.4);
  assert.equal(r1.best, 102.95);
  assert.equal(r1.relaxed, false);
  const binSell = (await p2pSources.binance({ asset: 'USDT', side: 'sell', amountInr: 10_000 })).ads;
  const r2 = p2pPrice(binSell, { side: 'sell', amountInr: 10_000, minCompletion: 0.9, minOrders: 20 });
  // 103.90 only goes to ₹1,000; 103.74 has 10 orders (< 20) → falls back to relaxed: 103.74 is the only fit.
  assert.equal(r2.relaxed, true);
  assert.equal(r2.price, 103.74);
  // Bybit: the ₹100-only bait ad at 90.12 never counts for a ₹10,000 trade
  const byBuy = p2pPrice((await p2pSources.bybit({ asset: 'USDT', side: 'buy', amountInr: 10_000 })).ads, { side: 'buy', amountInr: 10_000 });
  assert.equal(byBuy.best, 101.89);
  assert.equal(byBuy.price, 102.89);
  step('P2P: only ads that accept the trade size from good traders count; bait ads (₹100 limits, tiny stock) are ignored');

  const fill = bookFill({ bids: WAZIRX_USDT.bids.map(([p, q]) => [+p, +q]), asks: WAZIRX_USDT.asks.map(([p, q]) => [+p, +q]) }, { side: 'buy', amountInr: 200_000 });
  // ₹200,000 eats the 99.99 level (₹168,517) and part of 100.0
  assert.ok(fill.filled && fill.price > 99.99 && fill.price < 100.0, String(fill.price));
  assert.equal(fill.bestBid, 99.61);
  assert.equal(fill.bestAsk, 99.99);
  assert.equal(median([3, 1, 2, 100]), 2.5);
  const agg = robustAggregate([{ name: 'a', value: 103.4 }, { name: 'b', value: 102.89 }, { name: 'c', value: 107 }], 3);
  assert.deepEqual(agg.used, ['a', 'b']);
  assert.equal(agg.rejected[0].name, 'c');
  step('order books: fill price walks the real WazirX depth; cross-source median drops outliers');

  // ---------------------------------------------------------------- endpoints
  reset();
  let fx = ok(await get('/rates/forex'));
  assert.equal(fx.rate, 94.0153);
  assert.equal(fx.realtimeRate, 94.0153);
  assert.equal(fx.paise, 9402);
  assert.deepEqual(fx.used.sort(), ['coinbase', 'erapi', 'frankfurter']);
  assert.equal(fx.sources.find((s) => s.name === 'pyth').ok, false); // no key: reported, not fatal
  step('forex: USD/INR 94.0153 = median of Coinbase 94.0153 · ECB 93.92 · ExchangeRate-API 94.5370');

  let p2p = ok(await get('/rates/p2p?asset=USDT&side=buy&amountInr=10000'));
  assert.deepEqual(p2p.used.sort(), ['binance', 'bybit']);
  assert.equal(p2p.rejected[0].name, 'kucoin'); // 107 vs ~103: thin and pricey, dropped
  assert.equal(p2p.price, 103.145); // median(103.40, 102.89)
  assert.equal(p2p.bestPrice, 101.89);
  assert.equal(p2p.sources.find((s) => s.name === 'binance').top.length, 2);
  step('P2P buy USDT for ₹10,000: ₹103.145 (Binance 103.40, Bybit 102.89; KuCoin 107 rejected as an outlier)');

  const book = ok(await get('/rates/orderbook?asset=USDT&amountInr=10000'));
  assert.deepEqual(book.used.sort(), ['coindcx', 'wazirx']);
  assert.equal(book.sources.find((s) => s.name === 'wazirx').bestAsk, 99.99);
  assert.equal(book.sources.find((s) => s.name === 'coindcx').bestBid, 99.37);
  const usdcBook = ok(await get('/rates/orderbook?asset=USDC&amountInr=10000'));
  assert.equal(usdcBook.sources.find((s) => s.name === 'wazirx').ok, false); // no USDC/INR on WazirX: fallback to CoinDCX
  assert.deepEqual(usdcBook.used, ['coindcx']);
  step('spot books: USDT mid from WazirX + CoinDCX; USDC falls back to CoinDCX alone');

  const sum = ok(await get('/rates?amountInr=10000'));
  assert.equal(sum.forex.usdInr, 94.0153);
  assert.equal(sum.assets.USDT.p2p.buy.price, 103.145);
  assert.equal(sum.assets.USDT.p2p.premiumBps.buy, Math.round((103.145 / 94.0153 - 1) * 10_000)); // ~971 bps ≈ 9.7 % over forex
  assert.ok(sum.assets.USDC.p2p.buy.price > 100);
  step(`summary: USDT P2P buy is ${sum.assets.USDT.p2p.premiumBps.buy / 100}% over forex; spot mid ${sum.assets.USDT.spot.mid}`);

  // ---------------------------------------------------------------- fallback
  down = new Set(['binance']);
  svc.clearRatesCache();
  p2p = ok(await get('/rates/p2p?asset=USDT&side=buy&amountInr=10000'));
  assert.deepEqual(p2p.used, ['bybit']); // binance down → bybit carries it; kucoin (107) disagrees and loses on priority
  assert.equal(p2p.price, 102.89);
  assert.equal(p2p.sources.find((s) => s.name === 'binance').ok, false);
  step('one exchange down → the others carry the price (two that disagree: the more liquid one wins)');

  reset();
  ok(await get('/rates/p2p?asset=USDT&side=buy&amountInr=20000')); // good value cached
  down = new Set(['binance', 'bybit', 'kucoin']);
  // expire the cache entry but keep the last good value
  const realNow = Date.now;
  Date.now = () => realNow() + 60_000;
  let stale = ok(await get('/rates/p2p?asset=USDT&side=buy&amountInr=20000'));
  assert.equal(stale.stale, true);
  assert.ok(stale.ageSeconds >= 60);
  Date.now = () => realNow() + 2 * 3600_000; // beyond RATES_MAX_STALE_SECONDS
  const dead = await get('/rates/p2p?asset=USDT&side=buy&amountInr=20000');
  assert.equal(dead.status, 503);
  assert.equal(dead.body.error, 'rates_unavailable');
  assert.ok(dead.body.details.lastKnown.price > 0);
  Date.now = realNow;
  step('all sources down → last good value served as stale (15 min max), then 503 with the last known value');

  reset();
  down = new Set(['kucoin']);
  for (let i = 0; i < 3; i++) { svc.clearRatesCache(); await get('/rates/p2p?asset=USDT&side=buy&amountInr=10000'); }
  assert.ok(sourceHealth().kucoin.circuitOpenUntil);
  calls = [];
  svc.clearRatesCache();
  await get('/rates/p2p?asset=USDT&side=buy&amountInr=10000');
  assert.ok(!calls.includes('www.kucoin.com')); // skipped while the breaker is open
  const health = ok(await get('/rates/health'));
  assert.equal(health.sources.kucoin.consecutiveFailures, 3);
  step('circuit breaker: a source failing 3× is skipped for 60 s; /rates/health shows it');

  // ---------------------------------------------------------------- attestation + quote
  reset();
  const att = ok(await get('/rates/attestation?asset=USDC&amountInr=10000'));
  const signer = await recoverTypedDataAddress({
    domain: att.domain, types: att.types, primaryType: 'PriceAttestation',
    message: { ...att.attestation, amountInr: BigInt(att.attestation.amountInr), p2pBuyPaise: BigInt(att.attestation.p2pBuyPaise), p2pSellPaise: BigInt(att.attestation.p2pSellPaise), forexPaise: BigInt(att.attestation.forexPaise), observedAt: BigInt(att.attestation.observedAt) },
    signature: att.signature,
  });
  assert.equal(signer, privateKeyToAccount(signerKey).address);
  assert.equal(att.attestation.forexPaise, '9402');
  ok(await get('/rates/attestation?asset=USDT&amountInr=10000')); // buy 103.145 / sell 102.11: fine
  svc.clearRatesCache();
  down = new Set(['bybit']); // now Binance alone decides both sides: sell 103.74 > buy 103.40 at this size
  const crossed = await get('/rates/attestation?asset=USDT&amountInr=10000');
  assert.equal(crossed.body.error, 'crossed_market'); // refuse to sign an inverted market
  reset();
  step('signed PriceAttestation (EIP-712) recovers to the signer; crossed markets are refused');

  const quote = ok(await get('/rates/quote?asset=USDC&amountInr=5000&rewardBps=1650'));
  assert.equal(quote.band.tradable, true);
  assert.ok(quote.band.xFloor < quote.band.buyerCeiling && quote.band.buyerCeiling <= quote.band.xCap);
  assert.ok(quote.gains.sellerVsP2pPct >= 1 && quote.gains.buyerVsP2pPct >= 1);
  assert.equal((await get('/rates/quote?amountInr=50')).status, 400);
  step(`quote: USDC ₹5,000 with a 16.5% card reward → seller +${quote.gains.sellerVsP2pPct}%, buyer ${quote.gains.buyerVsP2pPct}% under P2P`);

  console.log('\nRates checks passed.');
} catch (err) {
  console.error('\nRATES TEST FAILED:', err);
  process.exitCode = 1;
} finally {
  server.close();
  setTimeout(() => process.exit(), 200);
}
