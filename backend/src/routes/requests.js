import { Router } from 'express';
import { z } from 'zod';
import { BRANDS, config } from '../config.js';
import { requireAuth, requireHuman, requireAdmin } from '../middleware/auth.js';
import { validate, txHash } from '../middleware/validate.js';
import * as svc from '../services/requests.js';

const router = Router();

const createSchema = z.object({
  brand: z.enum(BRANDS),
  amountInr: z.number().int().positive().max(100_000),
  // Decimal string to avoid float rounding, e.g. "11.25"
  amountUsdc: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Decimal string with up to 6 places'),
});

const listSchema = z.object({
  brand: z.enum(BRANDS).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
});

// ---------- Public reads ----------

/** GET /requests?brand=amazon&limit=20 → open (funded, unaccepted) requests */
router.get('/', validate(listSchema, 'query'), async (req, res) => {
  res.json({ requests: await svc.listOpen(req.validQuery) });
});

/** GET /requests/mine → requests where I'm requester or fulfiller */
router.get('/mine', requireAuth, async (req, res) => {
  res.json(await svc.listMine(req.user.address));
});

/** GET /requests/:id */
router.get('/:id', async (req, res) => {
  res.json({ request: await svc.getRequest(req.params.id) });
});

// ---------- Requester ----------

/**
 * POST /requests  { brand, amountInr, amountUsdc }
 * Returns the request with `escrowId` + `amountUsdcBaseUnits`; the frontend then calls
 * USDC.approve(escrow, amount) and escrow.deposit(escrowId, amount) from the user's wallet.
 */
router.post('/', requireAuth, requireHuman, validate(createSchema), async (req, res) => {
  const request = await svc.createRequest(req.user.address, req.body);
  res.status(201).json({ request, escrowContract: config.ESCROW_CONTRACT_ADDRESS || null });
});

/** POST /requests/:id/fund { txHash } → verifies deposit on Arc, status → open */
router.post('/:id/fund', requireAuth, requireHuman, validate(z.object({ txHash })), async (req, res) => {
  res.json({ request: await svc.fundRequest(req.params.id, req.user.address, req.body.txHash) });
});

/** POST /requests/:id/cancel → unfunded: cancelled; funded & unaccepted: refunded on-chain */
router.post('/:id/cancel', requireAuth, async (req, res) => {
  res.json({ request: await svc.cancelRequest(req.params.id, req.user.address) });
});

/** GET /requests/:id/voucher → decrypted code + pin (requester only, after submission) */
router.get('/:id/voucher', requireAuth, async (req, res) => {
  const isAdmin = config.ADMIN_ADDRESSES.includes(req.user.address);
  res.json({ voucher: await svc.getVoucher(req.params.id, req.user.address, { isAdmin }) });
});

/** POST /requests/:id/confirm → code works; release USDC to fulfiller */
router.post('/:id/confirm', requireAuth, async (req, res) => {
  res.json({ request: await svc.confirmRequest(req.params.id, req.user.address) });
});

// ---------- Fulfiller ----------

/** POST /requests/:id/accept → lock the request to me for FULFIL_WINDOW_MINUTES */
router.post('/:id/accept', requireAuth, requireHuman, async (req, res) => {
  res.json({ request: await svc.acceptRequest(req.params.id, req.user.address) });
});

/** POST /requests/:id/submit-code { code, pin? } → stored encrypted; review window starts */
router.post(
  '/:id/submit-code',
  requireAuth,
  requireHuman,
  validate(z.object({ code: z.string().trim().min(4).max(128), pin: z.string().trim().max(32).optional() })),
  async (req, res) => {
    res.json({ request: await svc.submitCode(req.params.id, req.user.address, req.body) });
  },
);

// ---------- Either party ----------

/** POST /requests/:id/dispute { reason } */
router.post('/:id/dispute', requireAuth, validate(z.object({ reason: z.string().trim().min(5).max(1000) })), async (req, res) => {
  res.json({ request: await svc.disputeRequest(req.params.id, req.user.address, req.body.reason) });
});

// ---------- Admin ----------

/**
 * POST /requests/:id/resolve { outcome: "release" | "refund", note?, fault? }
 * The party at fault is banned as a HUMAN (every wallet they used). Default: refund → fulfiller at fault,
 * release → requester at fault. Pass fault: "none" when it cannot be determined who is lying.
 */
router.post(
  '/:id/resolve',
  requireAuth,
  requireAdmin,
  validate(
    z.object({
      outcome: z.enum(['release', 'refund']),
      note: z.string().max(1000).optional(),
      fault: z.enum(['requester', 'fulfiller', 'none']).optional(),
    }),
  ),
  async (req, res) => {
    res.json({ request: await svc.resolveDispute(req.params.id, req.user.address, req.body.outcome, req.body.note, req.body.fault) });
  },
);

export default router;
