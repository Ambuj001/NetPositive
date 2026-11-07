import crypto from 'node:crypto';
import { parseUnits, getAddress } from 'viem';
import { config } from '../config.js';
import { db, col, FieldValue, Timestamp, serialize } from './firestore.js';
import { S, assertStatus, transition, settle, getRequest, bumpReputation, spenderOf, buyerOf } from './requests.js';
import { bondIdFor, verifyDepositById, readStatusById, releaseById, refundById } from './escrow.js';
import { HttpError, notFound, forbidden, conflict, badRequest } from '../lib/errors.js';

/**
 * Disputes.
 *
 *   Either party can raise one while the request is `code_submitted` (the requester only inside the review window).
 *   The person raising it stakes DISPUTE_BOND_USDC in the same escrow contract (its own escrow id).
 *   They add a reason, a category and up to a few screenshots (stored in Firestore). The other party may answer once.
 *   An admin then decides:
 *     disputer RIGHT : stake goes back to the disputer, the other party gets a strike, the trade is settled in the disputer's favour
 *     disputer WRONG : stake goes to the other party, the disputer is BANNED, the trade is settled in the other party's favour
 *
 * Firestore:
 *   requests/{id}.dispute                 { by, category, reason, openedAt, bond:{status,escrowId,amountBaseUnits,txHash,payoutTx}, response }
 *   requests/{id}.resolution              { verdict, mainOutcome, note, by, at, applied }
 *   requests/{id}/evidence/{auto}         { by, mime, size, sha256, note, data(base64), createdAt }
 *   requests/{id}/private/bond-{address}  { nonce }   (secret: makes each person's bond id impossible to front-run)
 */

export const CATEGORIES = [
  'invalid_code', // not activated / does not exist
  'already_redeemed',
  'wrong_amount',
  'wrong_brand',
  'expired',
  'code_changed', // not the code that was delivered
  'code_is_valid', // fulfiller: the code is fine and the requester is rejecting it
  'other',
];

const evidenceCol = (id) => col.requests.doc(id).collection('evidence');
const bondPrivateRef = (id, actor) => col.requests.doc(id).collection('private').doc(`bond-${actor}`);
const bondBaseUnits = () => parseUnits(config.DISPUTE_BOND_USDC, config.USDC_DECIMALS);
const bondEnabled = () => bondBaseUnits() > 0n;

const IMAGE_TYPES = {
  'image/png': (b) => b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])),
  'image/jpeg': (b) => b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/webp': (b) => b.length > 12 && b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP',
};

function assertParty(data, actor) {
  if (actor !== spenderOf(data) && actor !== buyerOf(data)) throw forbidden('not_party', 'Only a party to the trade can do this');
}

/** Firestore Timestamp (inside a transaction) or ISO string (from getRequest) -> epoch ms. */
const ms = (v) => (v?.toMillis ? v.toMillis() : Date.parse(v));

function assertCanDispute(data, actor) {
  assertStatus(data, S.CODE_SUBMITTED);
  assertParty(data, actor);
  if (actor === spenderOf(data) && ms(data.reviewDeadline) < Date.now()) {
    throw conflict('review_window_expired', 'Review window has expired; funds are being auto-released');
  }
}

const otherParty = (data, actor) => (actor === spenderOf(data) ? buyerOf(data) : spenderOf(data));

// ---------- Step 1: the stake ----------

/** Tells the disputer exactly what to deposit. Safe to call repeatedly: the nonce is created once and kept. */
export async function getBondTerms(id, actor) {
  const current = await getRequest(id);
  assertCanDispute(current, actor);
  const base = { required: bondEnabled(), amountUsdc: config.DISPUTE_BOND_USDC, token: 'USDC' };
  if (!bondEnabled()) return base;

  const ref = bondPrivateRef(id, actor);
  let snap = await ref.get();
  if (!snap.exists) {
    try {
      await ref.create({ nonce: crypto.randomBytes(16).toString('hex'), createdAt: FieldValue.serverTimestamp() });
    } catch {
      /* created concurrently: read it below */
    }
    snap = await ref.get();
  }
  return {
    ...base,
    amountBaseUnits: bondBaseUnits().toString(),
    escrowContract: config.ESCROW_CONTRACT_ADDRESS || null,
    escrowId: bondIdFor(id, actor, snap.data().nonce),
    how: 'USDC.approve(escrowContract, amountBaseUnits) then escrow.deposit(escrowId, amountBaseUnits) from your wallet, then POST the tx hash as bondTxHash.',
  };
}

// ---------- Step 2: raise it ----------

export async function openDispute(id, actor, { category, reason, bondTxHash }) {
  const current = await getRequest(id);
  assertCanDispute(current, actor);

  let bond = { status: 'none' };
  if (bondEnabled()) {
    if (!bondTxHash) throw badRequest('bond_required', `Stake ${config.DISPUTE_BOND_USDC} USDC first (POST /requests/:id/dispute/bond tells you how)`);
    const priv = await bondPrivateRef(id, actor).get();
    if (!priv.exists) throw badRequest('bond_not_prepared', 'Call POST /requests/:id/dispute/bond first');
    const escrowId = bondIdFor(id, actor, priv.data().nonce);
    await verifyDepositById({ id: escrowId, depositor: actor, amountBaseUnits: bondBaseUnits().toString(), txHash: bondTxHash });
    bond = { status: 'held', escrowId, amountBaseUnits: bondBaseUnits().toString(), txHash: bondTxHash };
  }

  const updated = await transition(id, actor, 'disputed', (data) => {
    assertCanDispute(data, actor);
    return {
      status: S.DISPUTED,
      disputedBy: actor,
      disputeReason: reason,
      disputedAt: FieldValue.serverTimestamp(),
      dispute: { by: actor, category, reason, openedAt: Timestamp.now(), bond, response: null },
    };
  });
  await Promise.all([bumpReputation(spenderOf(updated), 'disputes'), bumpReputation(buyerOf(updated), 'disputes')]);
  return updated;
}

export async function respondToDispute(id, actor, text) {
  return transition(id, actor, 'dispute_response', (data) => {
    assertStatus(data, S.DISPUTED);
    assertParty(data, actor);
    const by = data.dispute?.by ?? data.disputedBy;
    if (actor === by) throw forbidden('not_opposition', 'Only the other party can respond');
    if (data.dispute?.response) throw conflict('already_responded', 'You already responded');
    return { 'dispute.response': { by: actor, text, at: Timestamp.now() } };
  });
}

// ---------- Evidence (screenshots in Firestore) ----------

export async function addEvidence(id, actor, { mime, bytes, note }) {
  const detect = IMAGE_TYPES[mime];
  if (!detect) throw new HttpError(415, 'unsupported_type', 'Only PNG, JPEG or WebP screenshots');
  if (!Buffer.isBuffer(bytes) || bytes.length === 0) throw badRequest('empty_image', 'Send the image bytes as the request body');
  if (bytes.length > config.DISPUTE_MAX_IMAGE_BYTES) throw new HttpError(413, 'image_too_large', `Max ${config.DISPUTE_MAX_IMAGE_BYTES} bytes per screenshot`);
  if (!detect(bytes)) throw badRequest('image_mismatch', 'The file is not a real image of the declared type');

  const reqRef = col.requests.doc(id);
  const evRef = evidenceCol(id).doc();
  const meta = { by: actor, mime, size: bytes.length, sha256: crypto.createHash('sha256').update(bytes).digest('hex'), note: note ?? null };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(reqRef);
    if (!snap.exists) throw notFound('Request not found');
    const data = snap.data();
    assertStatus(data, S.DISPUTED);
    assertParty(data, actor);
    const used = data.evidenceCounts?.[actor] ?? 0;
    if (used >= config.DISPUTE_MAX_EVIDENCE_PER_PARTY) throw conflict('evidence_limit', `Max ${config.DISPUTE_MAX_EVIDENCE_PER_PARTY} screenshots per person`);
    tx.create(evRef, { ...meta, data: bytes.toString('base64'), createdAt: FieldValue.serverTimestamp() });
    tx.update(reqRef, { [`evidenceCounts.${actor}`]: used + 1, updatedAt: FieldValue.serverTimestamp() });
  });
  return { id: evRef.id, ...meta };
}

function assertCanView(data, viewer, isAdmin) {
  if (!isAdmin && viewer !== spenderOf(data) && viewer !== buyerOf(data)) throw forbidden('not_party', 'Only the two parties and admins can see dispute evidence');
}

export async function listEvidence(id, viewer, { isAdmin = false } = {}) {
  const data = await getRequest(id);
  assertCanView(data, viewer, isAdmin);
  const snap = await evidenceCol(id).orderBy('createdAt', 'asc').limit(50).get();
  return snap.docs.map((d) => {
    const { data: _omit, ...meta } = d.data();
    return serialize({ id: d.id, ...meta });
  });
}

export async function getEvidenceImage(id, evidenceId, viewer, { isAdmin = false } = {}) {
  const data = await getRequest(id);
  assertCanView(data, viewer, isAdmin);
  const snap = await evidenceCol(id).doc(evidenceId).get();
  if (!snap.exists) throw notFound('Evidence not found');
  const e = snap.data();
  return { mime: e.mime, bytes: Buffer.from(e.data, 'base64'), sha256: e.sha256 };
}

// ---------- Step 3: the decision ----------

/**
 * verdict: 'disputer_right' | 'disputer_wrong'. The trade's outcome follows from who disputed:
 *   requester right -> refund the requester      requester wrong -> release to the fulfiller
 *   fulfiller right -> release to the fulfiller  fulfiller wrong -> refund the requester
 * Safe to call again after a failure: the verdict is recorded once and every step checks what is already done.
 */
export async function resolveDispute(id, admin, { verdict, note }) {
  const resolved = await transition(id, admin, 'dispute_resolved', (data) => {
    assertStatus(data, S.DISPUTED);
    const disputer = data.dispute?.by ?? data.disputedBy;
    const mainOutcome = (verdict === 'disputer_right') === (disputer === spenderOf(data)) ? 'refund' : 'release';
    if (data.resolution) {
      if (data.resolution.verdict !== verdict) throw conflict('already_resolved', `This dispute was already decided as "${data.resolution.verdict}"`);
      return {};
    }
    return { resolution: { verdict, mainOutcome, note: note ?? null, by: admin, at: Timestamp.now(), applied: false } };
  });

  const disputer = resolved.dispute?.by ?? resolved.disputedBy;
  const opposition = otherParty(resolved, disputer);
  const right = resolved.resolution.verdict === 'disputer_right';

  // The stake: back to the disputer, or to the other party.
  const bond = resolved.dispute?.bond;
  if (bond?.status === 'held') {
    let payoutTx = 'already-paid-on-chain';
    try {
      const onchain = await readStatusById(bond.escrowId);
      const done = onchain === (right ? 'refunded' : 'released');
      if (!done) payoutTx = right ? await refundById(bond.escrowId) : await releaseById(bond.escrowId, getAddress(opposition));
    } catch (err) {
      console.error(`[dispute] bond payout ${id} failed:`, err.message);
      throw new HttpError(502, 'bond_payout_failed', 'Moving the stake failed; the dispute stays open, try resolving again');
    }
    await transition(id, admin, right ? 'bond_returned' : 'bond_forfeited', (data) => {
      assertStatus(data, S.DISPUTED);
      return { 'dispute.bond.status': right ? 'returned' : 'forfeited', 'dispute.bond.payoutTx': payoutTx };
    });
  }

  // Consequences, applied exactly once even if the settlement below needs a retry.
  let firstTime = false;
  await transition(id, admin, 'dispute_consequences', (data) => {
    assertStatus(data, S.DISPUTED);
    if (data.resolution.applied) return {};
    firstTime = true;
    return { 'resolution.applied': true };
  });
  if (firstTime) {
    if (right) {
      await Promise.all([bumpReputation(opposition, 'strikes'), bumpReputation(opposition, 'disputesLost'), bumpReputation(disputer, 'disputesWon')]);
    } else {
      await col.users.doc(disputer).set({ banned: true, bannedReason: `false dispute on request ${id}`, bannedAt: FieldValue.serverTimestamp() }, { merge: true });
      await Promise.all([bumpReputation(disputer, 'disputesLost'), bumpReputation(opposition, 'disputesWon')]);
    }
  }

  return settle(id, admin, resolved.resolution.mainOutcome, [S.DISPUTED]);
}
