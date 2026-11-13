import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { validate } from '../middleware/validate.js';
import * as rates from '../rates/service.js';

const router = Router();
const asset = z.enum(['USDT', 'USDC']).default('USDT');
const amountInr = z.coerce.number().int().min(100).max(10_000_000).default(config.RATES_DEFAULT_AMOUNT_INR);
const q = (schema) => validate(z.object(schema), 'query');

// Rates change every few seconds: never let a browser/CDN cache them longer than our own TTL.
router.use((_req, res, next) => { res.set('cache-control', 'public, max-age=15'); next(); });

/** GET /rates?amountInr= → everything: USD/INR, P2P buy/sell and spot for USDT & USDC, premiums over forex */
router.get('/', q({ amountInr }), async (req, res) => res.json(await rates.getSummary(req.validQuery)));

/** GET /rates/forex → USD/INR from Coinbase (real time), ECB (Frankfurter) and ExchangeRate-API, with per-source detail */
router.get('/forex', async (_req, res) => res.json(await rates.getForex()));

/** GET /rates/p2p?asset=USDT&side=buy|sell&amountInr=10000 → executable P2P price for that size, per exchange (top ads) + aggregate */
router.get('/p2p', q({ asset, side: z.enum(['buy', 'sell']).default('buy'), amountInr }), async (req, res) => res.json(await rates.getP2P(req.validQuery)));

/** GET /rates/orderbook?asset=USDT&amountInr= → Indian spot books (WazirX, CoinDCX): best bid/ask, mid, fill price for that size */
router.get('/orderbook', q({ asset, amountInr }), async (req, res) => res.json(await rates.getBooks(req.validQuery)));

/** GET /rates/quote?asset=USDT&amountInr=5000&rewardBps=1650 → NetPositive pricing band (seller floor/cap, buyer ceiling) */
router.get(
  '/quote',
  q({ asset, amountInr, rewardBps: z.coerce.number().int().min(0).max(5000).default(0), sMinBps: z.coerce.number().int().min(0).max(800).default(100), sMaxBps: z.coerce.number().int().min(0).max(800).default(800) }),
  async (req, res) => res.json(await rates.getQuote(req.validQuery)),
);

/** GET /rates/attestation?asset=USDT&amountInr= → EIP-712 signed PriceAttestation (refuses stale or crossed markets) */
router.get('/attestation', q({ asset, amountInr }), async (req, res) => res.json(await rates.getAttestation(req.validQuery)));

/** GET /rates/history?limit=120 → snapshots taken by the background refresher */
router.get('/history', q({ limit: z.coerce.number().int().min(1).max(720).default(120) }), (req, res) => res.json({ points: rates.getHistory(req.validQuery.limit) }));

/** GET /rates/health → per-source status: last success, last error, latency, circuit breaker */
router.get('/health', (_req, res) => res.json(rates.ratesHealth()));

export default router;
