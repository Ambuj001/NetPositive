import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { col, db, FieldValue, serialize } from '../services/firestore.js';
import { signWorldIdRequest, verifyWorldIdProof, worldIdReady } from '../services/worldid.js';
import { requireAuth } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { badRequest, conflict } from '../lib/errors.js';

const router = Router();

const responseItem = z.looseObject({
  identifier: z.string(),
  signal_hash: z.string().optional(),
  nullifier: z.string().optional(),
  issuer_schema_id: z.number().optional(),
});

const verifyBody = z.object({
  rp_id: z.string().min(1),
  idkitResponse: z.looseObject({
    protocol_version: z.enum(['3.0', '4.0']),
    nonce: z.string().min(1),
    action: z.string().min(1),
    environment: z.enum(['production', 'staging', 'sandbox']),
    responses: z.array(responseItem).min(1),
  }),
});

/**
 * GET /world-id/config → public values the frontend passes to IDKit.
 * The signal MUST be the signed-in wallet address so the proof is bound to it.
 */
router.get('/config', (_req, res) => {
  res.json({
    app_id: config.WORLD_ID_APP_ID,
    rp_id: config.WORLD_ID_RP_ID || null,
    action: config.WORLD_ID_ACTION,
    environment: config.WORLD_ID_ENV,
    ready: worldIdReady(),
  });
});

/**
 * POST /world-id/rp-signature   (auth required)
 * Body: { action? } — must match the server action when present.
 * Signs the Proof of Human request. The signing key stays on the server.
 */
router.post('/rp-signature', requireAuth, (req, res) => {
  const requested = req.body?.action;
  if (requested != null && requested !== config.WORLD_ID_ACTION) {
    throw badRequest('world_id_action', 'Unexpected World ID action');
  }
  res.json(signWorldIdRequest());
});

/**
 * POST /world-id/verify   (auth required)
 * Body: { rp_id, idkitResponse } — the IDKit success result, forwarded unchanged to World.
 *
 * Then binds nullifier ↔ wallet in one transaction:
 *   - same human, same wallet  → idempotent OK
 *   - same human, other wallet → 409 (one human, one account)
 *   - wallet already bound to a different human → 409
 */
router.post('/verify', requireAuth, validate(verifyBody), async (req, res) => {
  const wallet = req.user.address;
  const { nullifierHash, verificationLevel } = await verifyWorldIdProof(req.body, wallet);

  const nullRef = col.nullifiers.doc(nullifierHash);
  const userRef = col.users.doc(wallet);

  await db.runTransaction(async (tx) => {
    const [nullSnap, userSnap] = await Promise.all([tx.get(nullRef), tx.get(userRef)]);

    if (nullSnap.exists && nullSnap.data().address !== wallet) {
      throw conflict('world_id_already_used', 'This World ID is already linked to another wallet');
    }
    const existing = userSnap.data()?.worldIdNullifier;
    if (existing && existing !== nullifierHash) {
      throw conflict('wallet_already_verified', 'This wallet is already linked to a different World ID');
    }
    if (nullSnap.exists) return;

    tx.create(nullRef, { address: wallet, action: config.WORLD_ID_ACTION, verificationLevel, createdAt: FieldValue.serverTimestamp() });
    tx.update(userRef, { worldIdNullifier: nullifierHash, verificationLevel, worldIdVerifiedAt: FieldValue.serverTimestamp() });
  });

  const user = (await userRef.get()).data();
  res.json({ verified: true, user: serialize(user) });
});

export default router;
