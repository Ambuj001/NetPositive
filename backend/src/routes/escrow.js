import { Router } from 'express';
import { escrowTerms } from '../services/escrow.js';

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

export default router;
