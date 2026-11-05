import { Router } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { verifyMessage } from 'viem';
import { col, db, FieldValue, Timestamp, serialize } from '../services/firestore.js';
import { publicClient } from '../services/escrow.js';
import { validate, address, hex } from '../middleware/validate.js';
import { issueToken, requireAuth } from '../middleware/auth.js';
import { unauthorized } from '../lib/errors.js';

const router = Router();
const NONCE_TTL_MS = 5 * 60_000;

/**
 * Wallet sign-in, step 1: get a one-time message to sign.
 * POST /auth/nonce { address }  →  { message }
 */
router.post('/nonce', validate(z.object({ address })), async (req, res) => {
  const nonce = randomBytes(16).toString('hex');
  const issuedAt = new Date().toISOString();
  const message = [
    'Sign in to NetPositive',
    '',
    `Address: ${req.body.address}`,
    `Nonce: ${nonce}`,
    `Issued At: ${issuedAt}`,
    '',
    'This request will not trigger a transaction or cost any gas.',
  ].join('\n');

  await col.nonces.doc(req.body.address).set({
    message,
    expiresAt: Timestamp.fromMillis(Date.now() + NONCE_TTL_MS),
  });
  res.json({ message });
});

/**
 * Wallet sign-in, step 2: submit the signature.
 * POST /auth/verify { address, signature }  →  { token, user }
 * Uses publicClient.verifyMessage so smart-contract wallets (ERC-1271/6492) work too.
 */
router.post('/verify', validate(z.object({ address, signature: hex })), async (req, res) => {
  const { address: addr, signature } = req.body;
  const nonceRef = col.nonces.doc(addr);

  // Consume the nonce atomically so a signature can't be replayed.
  const message = await db.runTransaction(async (tx) => {
    const snap = await tx.get(nonceRef);
    if (!snap.exists) throw unauthorized('No pending sign-in; request a new nonce');
    tx.delete(nonceRef);
    const { message, expiresAt } = snap.data();
    if (expiresAt.toMillis() < Date.now()) throw unauthorized('Nonce expired');
    return message;
  });

  // EOA signatures verify locally; fall back to RPC for smart-contract wallets.
  const valid =
    (await verifyMessage({ address: addr, message, signature }).catch(() => false)) ||
    (await publicClient.verifyMessage({ address: addr, message, signature }).catch(() => false));
  if (!valid) throw unauthorized('Bad signature');

  const userRef = col.users.doc(addr);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(userRef);
    if (snap.exists) {
      tx.update(userRef, { lastLoginAt: FieldValue.serverTimestamp() });
    } else {
      tx.create(userRef, {
        address: addr,
        worldIdNullifier: null,
        worldIdVerifiedAt: null,
        verificationLevel: null,
        reputation: { completed: 0, disputes: 0, strikes: 0 },
        banned: false,
        createdAt: FieldValue.serverTimestamp(),
        lastLoginAt: FieldValue.serverTimestamp(),
      });
    }
  });

  const user = (await userRef.get()).data();
  res.json({ token: issueToken(addr), user: serialize(user) });
});

/** GET /auth/me → current user profile */
router.get('/me', requireAuth, (req, res) => {
  res.json({ user: serialize(req.user) });
});

export default router;
