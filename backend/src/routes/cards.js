import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import * as svc from '../services/cards.js';

const router = Router();

const id = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9_-]{0,63}$/, 'Letters, digits, - and _ only, up to 64');
const num = (min, max) => z.number().finite().min(min).max(max);
const text = (max, min = 0) => z.string().trim().min(min).max(max);

const channel = z
  .object({
    id,
    name: text(80, 1),
    multiplier: num(0, 100),
    instantDiscount: num(0, 1).optional(),
    denomination: z.number().int().min(1).max(10_000_000),
    note: text(200),
  })
  .strict();

/** Same limits the app's own card form enforces, repeated here because the server must not trust the browser. */
const card = z
  .object({
    id,
    issuer: text(60, 1),
    name: text(80, 1),
    last: text(20),
    gradient: text(300),
    pointsPer: num(0, 100),
    spendUnit: num(0.01, 100_000),
    travelValue: num(0, 100),
    statementValue: num(0, 100),
    bonusCap: num(0, 10_000_000),
    bonusUsed: num(0, 10_000_000),
    channels: z.array(channel).min(1).max(12),
  })
  .strict();

/** GET /cards → { cards, promptDismissed } for the signed-in wallet. */
router.get('/', requireAuth, async (req, res) => {
  res.json(await svc.listCards(req.user.address));
});

/** PUT /cards/:id  (a card) → add it, or update it if it is already saved. */
router.put('/:id', requireAuth, validate(card), async (req, res) => {
  if (req.body.id !== req.params.id) return res.status(400).json({ error: 'id_mismatch', message: 'The card id in the body must match the URL' });
  res.json({ card: await svc.saveCard(req.user.address, req.body) });
});

/** DELETE /cards/:id */
router.delete('/:id', requireAuth, async (req, res) => {
  if (!id.safeParse(req.params.id).success) return res.status(400).json({ error: 'validation_error', message: 'Invalid card id' });
  await svc.removeCard(req.user.address, req.params.id);
  res.json({ ok: true });
});

/** POST /cards/prompt/dismiss → they closed the "add your cards" pop-up. */
router.post('/prompt/dismiss', requireAuth, async (req, res) => {
  await svc.dismissCardsPrompt(req.user.address);
  res.json({ ok: true });
});

export default router;
