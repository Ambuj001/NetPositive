import { Router } from 'express';
import { requireAuth } from '../middleware/auth.js';
import * as svc from '../services/recovery.js';

const router = Router();

/**
 * POST /recovery/start   (sign in with the NEW wallet)
 * Body: a World ID result for THIS wallet (get the request from POST /world-id/request, then run IDKit).
 * Must be the same human as the account being recovered. Starts the waiting period.
 */
router.post('/start', requireAuth, async (req, res) => {
  res.status(201).json({ recovery: await svc.startRecovery(req.user.address, req.user, req.body) });
});

/** GET /recovery/mine → recoveries where I am the new wallet or the old wallet */
router.get('/mine', requireAuth, async (req, res) => {
  res.json(await svc.listRecoveries(req.user.address));
});

/** POST /recovery/:id/cancel   (the OLD wallet, during the waiting period) */
router.post('/:id/cancel', requireAuth, async (req, res) => {
  res.json({ recovery: await svc.cancelRecovery(req.user.address, req.params.id) });
});

/** POST /recovery/:id/complete   (the NEW wallet, after the waiting period) */
router.post('/:id/complete', requireAuth, async (req, res) => {
  res.json({ recovery: await svc.completeRecovery(req.user.address, req.params.id) });
});

export default router;
