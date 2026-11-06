import { Router } from 'express';
import { z } from 'zod';
import { BRANDS } from '../config.js';
import { requireAuth, requireHuman } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as svc from '../services/buyIntents.js';

const router = Router();

// Same ceiling as a spender's order (routes/requests.js): a larger buy request could never be matched.
const amount = z.number().int().positive().max(100_000);

const createSchema = z.object({
  amountInr: amount,
  // The voucher the buyer would use. Omitted or null means "none": any voucher will do.
  voucher: z.enum(BRANDS).nullable().optional(),
}).strict();

const matchSchema = z.object({
  amountInr: z.coerce.number().int().positive().max(100_000),
  brand: z.enum(BRANDS).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

/**
 * GET /buy-intents?amountInr=500&brand=amazon → active buy requests that fit (public).
 * An intent with a voucher matches only that brand; one without a voucher matches any brand. No `brand` means amount only.
 */
router.get('/', validate(matchSchema, 'query'), async (req, res) => {
  res.json({ intents: await svc.listMatching(req.validQuery) });
});

/** GET /buy-intents/mine → my active buy request, or null */
router.get('/mine', requireAuth, async (req, res) => {
  res.json({ intent: await svc.getIntent(req.user.address) });
});

/** POST /buy-intents { amountInr, voucher? } → create or replace my buy request. Verified humans only. */
router.post('/', requireAuth, requireHuman, validate(createSchema), async (req, res) => {
  res.status(201).json({ intent: await svc.upsertIntent(req.user.address, req.body) });
});

/** DELETE /buy-intents/mine → withdraw my buy request */
router.delete('/mine', requireAuth, async (req, res) => {
  await svc.cancelIntent(req.user.address);
  res.json({ ok: true });
});

export default router;
