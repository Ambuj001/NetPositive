import express, { Router } from 'express';
import { z } from 'zod';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate, txHash } from '../middleware/validate.js';
import { HttpError } from '../lib/errors.js';
import * as svc from '../services/disputes.js';
import { getRequest, spenderOf } from '../services/requests.js';

const router = Router();
const isAdmin = (req) => config.ADMIN_ADDRESSES.includes(req.user.address);

/** POST /requests/:id/dispute/bond -> what to stake (amount, escrow id). Call this before raising the dispute. */
router.post('/:id/dispute/bond', requireAuth, async (req, res) => {
  res.json({ bond: await svc.getBondTerms(req.params.id, req.user.address) });
});

/** POST /requests/:id/dispute { category, reason, bondTxHash } */
router.post(
  '/:id/dispute',
  requireAuth,
  validate(z.object({
    category: z.enum(svc.CATEGORIES),
    reason: z.string().trim().min(5).max(1000),
    bondTxHash: txHash.optional(),
  })),
  async (req, res) => {
    res.json({ request: await svc.openDispute(req.params.id, req.user.address, req.body) });
  },
);

/** POST /requests/:id/dispute/respond { text } -> the other party answers once */
router.post('/:id/dispute/respond', requireAuth, validate(z.object({ text: z.string().trim().min(5).max(1000) })), async (req, res) => {
  res.json({ request: await svc.respondToDispute(req.params.id, req.user.address, req.body.text) });
});

/**
 * POST /requests/:id/evidence?note=...   body = the raw image bytes, Content-Type image/png | image/jpeg | image/webp
 * Either party, while the dispute is open. Stored in Firestore.
 */
router.post(
  '/:id/evidence',
  requireAuth,
  express.raw({ type: ['image/png', 'image/jpeg', 'image/webp'], limit: config.DISPUTE_MAX_IMAGE_BYTES }),
  async (req, res) => {
    if (!Buffer.isBuffer(req.body)) throw new HttpError(415, 'unsupported_type', 'Send the screenshot as the raw body with Content-Type image/png, image/jpeg or image/webp');
    const note = typeof req.query.note === 'string' ? req.query.note.slice(0, 200) : undefined;
    const evidence = await svc.addEvidence(req.params.id, req.user.address, { mime: req.get('content-type').split(';')[0], bytes: req.body, note });
    res.status(201).json({ evidence });
  },
);

/** GET /requests/:id/evidence -> list (no image bytes). The two parties and admins only. */
router.get('/:id/evidence', requireAuth, async (req, res) => {
  res.json({ evidence: await svc.listEvidence(req.params.id, req.user.address, { isAdmin: isAdmin(req) }) });
});

/** GET /requests/:id/evidence/:evidenceId -> the image */
router.get('/:id/evidence/:evidenceId', requireAuth, async (req, res) => {
  const img = await svc.getEvidenceImage(req.params.id, req.params.evidenceId, req.user.address, { isAdmin: isAdmin(req) });
  res.set({ 'Content-Type': img.mime, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'", 'X-Evidence-Sha256': img.sha256 });
  res.send(img.bytes);
});

/**
 * POST /requests/:id/resolve  { verdict: "disputer_right" | "disputer_wrong", note? }   (admin)
 * Legacy { outcome: "release" | "refund" } is still accepted and converted to a verdict.
 */
router.post(
  '/:id/resolve',
  requireAuth,
  requireAdmin,
  validate(z.union([
    z.object({ verdict: z.enum(['disputer_right', 'disputer_wrong']), note: z.string().max(1000).optional() }).strict(),
    z.object({ outcome: z.enum(['release', 'refund']), note: z.string().max(1000).optional() }).strict(),
  ])),
  async (req, res) => {
    let { verdict } = req.body;
    if (!verdict) {
      const r = await getRequest(req.params.id);
      const disputer = r.dispute?.by ?? r.disputedBy;
      verdict = (req.body.outcome === 'refund') === (disputer === spenderOf(r)) ? 'disputer_right' : 'disputer_wrong';
    }
    res.json({ request: await svc.resolveDispute(req.params.id, req.user.address, { verdict, note: req.body.note }) });
  },
);

export default router;
