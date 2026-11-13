// Rate-source adapters. Each returns normalised data or throws. Response shapes were checked against the live
// APIs on 6 Nov 2026 (see scripts/rates-test.js fixtures). Public, unauthenticated endpoints only.
//
//   forex      coinbase (real time), frankfurter (ECB daily reference), erapi (ExchangeRate-API, daily),
//              pyth (FX.USD/INR, only with PYTH_API_KEY: Hermes answered 401 without one)
//   orderbook  wazirx, coindcx           (Indian spot INR markets)
//   p2p        binance, bybit, kucoin    (P2P ads, INR)  (OKX P2P isn't reachable from India)
import { fetchJson } from './http.js';

const num = (v) => (v == null || v === '' ? null : Number(v));

// ---------------------------------------------------------------- forex (INR per 1 USD)

export const forexSources = {
  async coinbase() {
    const j = await fetchJson('coinbase', 'https://api.coinbase.com/v2/exchange-rates?currency=USD');
    const rate = num(j?.data?.rates?.INR);
    if (!(rate > 0)) throw new Error('coinbase: no INR rate');
    return { rate, kind: 'realtime', asOf: new Date().toISOString() };
  },
  async frankfurter() {
    const j = await fetchJson('frankfurter', 'https://api.frankfurter.dev/v1/latest?base=USD&symbols=INR');
    const rate = num(j?.rates?.INR);
    if (!(rate > 0)) throw new Error('frankfurter: no INR rate');
    return { rate, kind: 'daily-ecb', asOf: `${j.date}T16:00:00+01:00` };
  },
  async erapi() {
    const j = await fetchJson('erapi', 'https://open.er-api.com/v6/latest/USD');
    if (j?.result !== 'success') throw new Error('erapi: not success');
    const rate = num(j.rates?.INR);
    if (!(rate > 0)) throw new Error('erapi: no INR rate');
    return { rate, kind: 'daily', asOf: new Date(j.time_last_update_unix * 1000).toISOString() };
  },
  async pyth({ apiKey } = {}) {
    if (!apiKey) throw new Error('pyth: PYTH_API_KEY not set');
    const id = '0ac0f9a2886fc2dd708bc66cc2cea359052ce89d324f45d95fadbc6c4fcf1809'; // FX.USD/INR
    const j = await fetchJson('pyth', `https://hermes.pyth.network/v2/updates/price/latest?ids[]=${id}&parsed=true`, { headers: { authorization: `Bearer ${apiKey}` } });
    const p = j?.parsed?.[0]?.price;
    if (!p) throw new Error('pyth: no price');
    return { rate: Number(p.price) * 10 ** Number(p.expo), kind: 'realtime-oracle', asOf: new Date(p.publish_time * 1000).toISOString() };
  },
};

// ---------------------------------------------------------------- order books (levels best-first, numbers)

const levels = (arr) => arr.map(([p, q]) => [Number(p), Number(q)]).filter(([p, q]) => p > 0 && q > 0);

export const orderbookSources = {
  async wazirx({ asset }) {
    const j = await fetchJson('wazirx', `https://api.wazirx.com/sapi/v1/depth?symbol=${asset.toLowerCase()}inr&limit=20`);
    if (!Array.isArray(j?.asks) || !Array.isArray(j?.bids)) throw new Error('wazirx: no book');
    return { bids: levels(j.bids).sort((a, b) => b[0] - a[0]), asks: levels(j.asks).sort((a, b) => a[0] - b[0]), asOf: new Date(j.timestamp).toISOString() };
  },
  async coindcx({ asset }) {
    // Book is an object { "price": "qty" } per side.
    const j = await fetchJson('coindcx', `https://public.coindcx.com/market_data/orderbook?pair=I-${asset}_INR`);
    if (!j?.bids || !j?.asks) throw new Error('coindcx: no book');
    return {
      bids: levels(Object.entries(j.bids)).sort((a, b) => b[0] - a[0]),
      asks: levels(Object.entries(j.asks)).sort((a, b) => a[0] - b[0]),
      asOf: new Date(j.timestamp).toISOString(),
    };
  },
};

// ---------------------------------------------------------------- P2P ads
// Normalised ad: { price, minInr, maxInr, completion (0–1|null), orders (30d|null), merchant, methods[] }
// side 'buy' = the user buys crypto with INR (ads from sellers); 'sell' = the user sells crypto for INR.

export const p2pSources = {
  async binance({ asset, side, amountInr }) {
    const j = await fetchJson('binance', 'https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search', {
      method: 'POST',
      body: { fiat: 'INR', asset, tradeType: side === 'buy' ? 'BUY' : 'SELL', page: 1, rows: 20, payTypes: [], publisherType: null, transAmount: amountInr ? String(amountInr) : undefined },
    });
    if (j?.code !== '000000' || !Array.isArray(j.data)) throw new Error(`binance: ${j?.message ?? j?.code ?? 'bad response'}`);
    return {
      totalAds: j.total ?? null,
      ads: j.data.map(({ adv, advertiser }) => ({
        price: num(adv.price),
        minInr: num(adv.minSingleTransAmount),
        maxInr: num(adv.dynamicMaxSingleTransAmount ?? adv.maxSingleTransAmount), // already capped by the coins left
        completion: num(advertiser.monthFinishRate),
        orders: num(advertiser.monthOrderCount),
        merchant: advertiser.userType === 'merchant',
        methods: (adv.tradeMethods ?? []).map((m) => m.identifier),
      })),
    };
  },
  async bybit({ asset, side, amountInr }) {
    const j = await fetchJson('bybit', 'https://api2.bybit.com/fiat/otc/item/online', {
      method: 'POST',
      body: { userId: '', tokenId: asset, currencyId: 'INR', payment: [], side: side === 'buy' ? '1' : '0', size: '20', page: '1', amount: amountInr ? String(amountInr) : '', authMaker: false, canTrade: false },
    });
    if (j?.ret_code !== 0 || !Array.isArray(j?.result?.items)) throw new Error(`bybit: ${j?.ret_msg ?? 'bad response'}`);
    return {
      totalAds: j.result.count ?? null,
      ads: j.result.items.map((i) => {
        const price = num(i.price);
        return {
          price,
          minInr: num(i.minAmount),
          maxInr: Math.min(num(i.maxAmount), num(i.lastQuantity) * price),
          completion: i.recentExecuteRate == null ? null : num(i.recentExecuteRate) / 100,
          orders: num(i.recentOrderNum),
          merchant: i.authStatus === 2 && i.userType !== 'PERSONAL',
          methods: (i.payments ?? []).map(String),
        };
      }),
    };
  },
  async kucoin({ asset, side }) {
    // KuCoin lists SELL ads for people who buy, BUY ads for people who sell. No trader stats in the list.
    const j = await fetchJson('kucoin', `https://www.kucoin.com/_api/otc/ad/list?currency=${asset}&side=${side === 'buy' ? 'SELL' : 'BUY'}&legal=INR&page=1&pageSize=20&status=PUTUP&lang=en_US`);
    if (!j?.success || !Array.isArray(j.items)) throw new Error(`kucoin: ${j?.msg ?? 'bad response'}`);
    return {
      totalAds: j.totalNum ?? null,
      ads: j.items.map((i) => {
        const price = num(i.floatPrice);
        return {
          price,
          minInr: num(i.limitMinQuote),
          maxInr: Math.min(num(i.limitMaxQuote), num(i.currencyBalanceQuantity) * price),
          completion: null,
          orders: null,
          merchant: false,
          methods: (i.adPayTypes ?? []).map((p) => p.payTypeCode),
        };
      }),
    };
  },
};
