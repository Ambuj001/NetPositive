import { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { col, db, FieldValue, serialize } from '../services/firestore.js';
import { verifyWorldIdProof } from '../services/worldid.js';
import { requireAuth } from '../middleware/auth.js';
import { validate, hex } from '../middleware/validate.js';
import { conflict } from '../lib/errors.js';

const router = Router();

const proofSchema = z.object({
  proof: hex,
  merkle_root: hex,
  nullifier_hash: hex,
  verification_level: z.enum(['orb', 'device']),
});

/**
 * GET /world-id/config → what the frontend passes to IDKit.
 * The signal MUST be the signed-in wallet address so the proof is bound to it.
 */
router.get('/config', (_req, res) => {
  res.json({ app_id: config.WORLD_ID_APP_ID, action: config.WORLD_ID_ACTION, min_level: config.WORLD_ID_MIN_LEVEL });
});

/**
 * POST /world-id/verify   (auth required)
 * Body: the IDKit success result { proof, merkle_root, nullifier_hash, verification_level }
 *
 * Verifies with World, then binds nullifier ↔ wallet in one transaction:
 *   - same human, same wallet  → idempotent OK
 *   - same human, other wallet → 409 (one human, one account)
 *   - wallet already bound to a different human → 409
 */
router.post('/verify', requireAuth, validate(proofSchema), async (req, res) => {
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
    if (nullSnap.exists) return; // already bound, nothing to do

    tx.create(nullRef, { address: wallet, action: config.WORLD_ID_ACTION, verificationLevel, createdAt: FieldValue.serverTimestamp() });
    tx.update(userRef, { worldIdNullifier: nullifierHash, verificationLevel, worldIdVerifiedAt: FieldValue.serverTimestamp() });
  });

  const user = (await userRef.get()).data();
  res.json({ verified: true, user: serialize(user) });
});

export default router;
