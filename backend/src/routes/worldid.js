import { Router } from 'express';
import { config } from '../config.js';
import { requireAuth } from '../middleware/auth.js';
import { createRequest, verifyProof } from '../services/worldid.js';
import { bindHuman } from '../services/humans.js';

const router = Router();

/** GET /world-id/config → public IDs the frontend needs. */
router.get('/config', (_req, res) => {
  res.json({
    app_id: config.WORLD_ID_APP_ID,
    action: config.WORLD_ID_ACTION,
    environment: config.WORLD_ENVIRONMENT,
    rp_id: config.WORLD_RP_ID || null,
    credential: 'proof_of_human',
  });
});

/**
 * POST /world-id/request   (auth required)
 * Returns the signed request for IDKit. The signal is the signed-in wallet, so the proof is bound to it.
 */
router.post('/request', requireAuth, async (req, res) => {
  res.json(await createRequest(req.user.address));
});

/**
 * POST /world-id/verify   (auth required)
 * Body: the IDKit v4 result. Verified with World, then one human is bound to one wallet:
 *   - same human, same wallet  → idempotent OK
 *   - same human, other wallet → 409 world_id_already_used (use wallet recovery instead)
 *   - banned human             → 403 human_banned (on ANY wallet)
 */
router.post('/verify', requireAuth, async (req, res) => {
  const proof = await verifyProof(req.user.address, req.body);
  const user = await bindHuman(req.user.address, proof);
  res.json({ verified: true, user });
});

export default router;
