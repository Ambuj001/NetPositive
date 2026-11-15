import { Router } from 'express';
import { escrowTerms, readEscrow, chainNow, isMock } from '../services/escrow.js';
import { HttpError } from '../lib/errors.js';

const router = Router();

/**
 * GET /escrow/terms → what the escrow contract will charge and allow right now, read from the contract:
 * fee, order limits, the launch cap and how much of it is in use, the dispute stake, the time windows and whether new
 * deposits are paused. The app shows these before any wallet prompt. Amounts are 6-decimal USDC base units as strings.
 */
router.get('/terms', async (_req, res) => {
  res.set('cache-control', 'public, max-age=15');
  res.json(await escrowTerms());
});

/**
 * GET /escrow/state/:escrowId → the escrow record as this server reads it from the contract, with the chain's clock.
 * A fallback for browsers that cannot reach an Arc node themselves (blocked or rate-limited). It is the server's
 * word, not an independent check: the app says so when it uses it. 404 in mock mode.
 */
router.get('/state/:escrowId', async (req, res) => {
  if (isMock) throw new HttpError(404, 'not_found', 'No contract in mock mode');
  if (!/^0x[0-9a-fA-F]{64}$/.test(req.params.escrowId)) throw new HttpError(400, 'bad_escrow_id', 'Escrow id must be a 32-byte hash');
  const [e, now] = await Promise.all([readEscrow(req.params.escrowId), chainNow()]);
  res.set('cache-control', 'no-store');
  res.json({ escrow: { ...e, amount: e.amount.toString(), fee: e.fee.toString(), bond: e.bond.toString() }, chainTime: now, source: 'server' });
});

export default router;
