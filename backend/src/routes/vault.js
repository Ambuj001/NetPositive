import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middleware/auth.js';
import { validate, address } from '../middleware/validate.js';
import { badRequest } from '../lib/errors.js';
import * as svc from '../services/vault.js';

const router = Router();

/** GET /vault/config → mode, the message to sign, and the optional dispute public key. Public. */
router.get('/config', (_req, res) => res.json(svc.vaultConfig()));

/** PUT /vault/key { publicKey, signature } → register my vault public key (wallet-signed). Cannot be replaced. */
router.put(
  '/key',
  requireAuth,
  validate(z.object({ publicKey: z.string().regex(/^[0-9a-fA-F]{64}$/), signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict()),
  async (req, res) => res.json({ key: await svc.registerKey(req.user.address, req.body) }),
);

/** GET /vault/key/:address → someone's vault public key + the signature that binds it to their wallet (verify it client-side). */
router.get('/key/:address', requireAuth, async (req, res) => {
  const a = address.safeParse(req.params.address);
  if (!a.success) throw badRequest('validation_error', 'Must be a 0x-prefixed 20-byte address');
  res.json({ key: await svc.getKey(a.data) });
});

/** GET /vault → my received vouchers: sealed envelopes + my own encrypted state. */
router.get('/', requireAuth, async (req, res) => res.json(await svc.listVault(req.user.address)));

/** PUT /vault/:requestId/state { blob } → store my own encrypted note/redeemed flag (opaque to the server). */
router.put('/:requestId/state', requireAuth, validate(z.object({ blob: z.any() }).strict()), async (req, res) => {
  if (!/^[A-Za-z0-9]{1,64}$/.test(req.params.requestId)) throw badRequest('validation_error', 'Bad request id');
  res.json(await svc.putState(req.user.address, req.params.requestId, req.body.blob));
});

export default router;
