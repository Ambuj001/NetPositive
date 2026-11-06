import { parseUnits } from 'viem';
import { config } from '../config.js';
import { db, col, voucherRef, eventsRef, FieldValue, Timestamp, serialize } from './firestore.js';
import { escrowIdFor, verifyDeposit, releaseEscrow, refundEscrow, readEscrowStatus } from './escrow.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { HttpError, notFound, forbidden, conflict, badRequest } from '../lib/errors.js';
import { assertSealedAcceptable } from './vault.js';

/**
 * Lifecycle
 *
 *   pending_funding ──fund──▶ open ──accept──▶ accepted ──submit-code──▶ code_submitted
 *        │                     ▲  │                │                         │   │   │
 *     cancel              timeout  cancel        (fulfil window          confirm │ dispute
 *        ▼                     └──┼──────────────  expires)                │  timeout │
 *    cancelled                    ▼                                        ▼   ▼    ▼
 *                            refunding ──▶ refunded           releasing ──▶ released  disputed
 *                                                                                    (admin resolves → release | refund)
 *
 * `releasing` / `refunding` are locks held while the on-chain call is in flight.
 */
export const S = {
  PENDING_FUNDING: 'pending_funding',
  OPEN: 'open',
  ACCEPTED: 'accepted',
  CODE_SUBMITTED: 'code_submitted',
  DISPUTED: 'disputed',
  RELEASING: 'releasing',
  RELEASED: 'released',
  REFUNDING: 'refunding',
  REFUNDED: 'refunded',
  CANCELLED: 'cancelled',
};

const minutesFromNow = (m) => Timestamp.fromMillis(Date.now() + m * 60_000);

function assertStatus(data, ...allowed) {
  if (!allowed.includes(data.status)) {
    throw conflict('invalid_status', `Request is "${data.status}"; expected ${allowed.map((s) => `"${s}"`).join(' or ')}`);
  }
}

/**
 * Read-check-write inside a Firestore transaction and append an audit event.
 * `fn(data, tx)` validates and returns the field updates. It must not do network I/O
 * other than Firestore (transactions may be retried).
 */
async function transition(id, actor, event, fn) {
  const ref = col.requests.doc(id);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('Request not found');
    const data = snap.data();
    const updates = await fn(data, tx);
    tx.update(ref, { ...updates, updatedAt: FieldValue.serverTimestamp() });
    tx.create(eventsRef(id).doc(), {
      type: event,
      from: data.status,
      to: updates.status ?? data.status,
      actor,
      at: FieldValue.serverTimestamp(),
    });
  });
  return getRequest(id);
}

function bumpReputation(address, field, by = 1) {
  if (!address) return Promise.resolve();
  return col.users
    .doc(address)
    .set({ reputation: { [field]: FieldValue.increment(by) } }, { merge: true })
    .catch((err) => console.error(`[reputation] ${address}.${field}:`, err.message));
}

// ---------- Reads ----------

export async function getRequest(id) {
  const snap = await col.requests.doc(id).get();
  if (!snap.exists) throw notFound('Request not found');
  return serialize({ id: snap.id, ...snap.data() });
}

export async function listOpen({ brand, limit = 50 }) {
  let q = col.requests.where('status', '==', S.OPEN);
  if (brand) q = q.where('brand', '==', brand);
  const snap = await q.orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => serialize({ id: d.id, ...d.data() }));
}

export async function listMine(address) {
  const [asRequester, asFulfiller] = await Promise.all([
    col.requests.where('requester', '==', address).orderBy('createdAt', 'desc').limit(100).get(),
    col.requests.where('fulfiller', '==', address).orderBy('createdAt', 'desc').limit(100).get(),
  ]);
  return {
    asRequester: asRequester.docs.map((d) => serialize({ id: d.id, ...d.data() })),
    asFulfiller: asFulfiller.docs.map((d) => serialize({ id: d.id, ...d.data() })),
  };
}

// ---------- Requester actions ----------

export async function createRequest(requester, { brand, amountInr, amountUsdc }) {
  const ref = col.requests.doc();
  const amountUsdcBaseUnits = parseUnits(amountUsdc, config.USDC_DECIMALS).toString();
  if (BigInt(amountUsdcBaseUnits) <= 0n) throw new HttpError(400, 'invalid_amount', 'amountUsdc must be > 0');

  const doc = {
    requester,
    fulfiller: null,
    brand,
    amountInr,
    amountUsdc,
    amountUsdcBaseUnits,
    escrowId: escrowIdFor(ref.id),
    status: S.PENDING_FUNDING,
    escrowTxHash: null,
    releaseTxHash: null,
    refundTxHash: null,
    fulfilDeadline: null,
    reviewDeadline: null,
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
  };
  const batch = db.batch();
  batch.create(ref, doc);
  batch.create(eventsRef(ref.id).doc(), { type: 'created', from: null, to: S.PENDING_FUNDING, actor: requester, at: FieldValue.serverTimestamp() });
  await batch.commit();
  return getRequest(ref.id);
}

export async function fundRequest(id, requester, txHash) {
  const current = await getRequest(id);
  if (current.requester !== requester) throw forbidden('not_requester', 'Only the requester can fund this request');
  assertStatus(current, S.PENDING_FUNDING);

  // Chain check happens outside the transaction; the transaction re-checks status.
  await verifyDeposit({ requestId: id, depositor: requester, amountBaseUnits: current.amountUsdcBaseUnits, txHash });

  return transition(id, requester, 'funded', (data) => {
    assertStatus(data, S.PENDING_FUNDING);
    return { status: S.OPEN, escrowTxHash: txHash, fundedAt: FieldValue.serverTimestamp() };
  });
}

export async function cancelRequest(id, requester) {
  const current = await getRequest(id);
  if (current.requester !== requester) throw forbidden('not_requester', 'Only the requester can cancel');

  if (current.status === S.PENDING_FUNDING) {
    return transition(id, requester, 'cancelled', (data) => {
      assertStatus(data, S.PENDING_FUNDING);
      return { status: S.CANCELLED };
    });
  }
  // Funded but nobody has accepted yet: refund on-chain.
  return settle(id, requester, 'refund', [S.OPEN]);
}

export async function getVoucher(id, viewer, { isAdmin = false } = {}) {
  const current = await getRequest(id);
  const allowedViewer = viewer === current.requester || (isAdmin && current.status === S.DISPUTED);
  if (!allowedViewer) throw forbidden('not_requester', 'Only the requester can view the voucher');
  assertStatus(current, S.CODE_SUBMITTED, S.DISPUTED, S.RELEASING, S.RELEASED);

  const snap = await voucherRef(id).get();
  if (!snap.exists) throw notFound('Voucher not found');
  const stored = snap.data();
  if (stored.sealed) {
    // Sealed: the server cannot read it. The requester (or the dispute key holder) opens it in their own browser.
    return { requestId: id, brand: current.brand, requester: current.requester, fulfiller: current.fulfiller, sealed: stored.sealed };
  }
  const { code, pin } = JSON.parse(decrypt(stored.box, id));
  return { requestId: id, brand: current.brand, code, pin: pin ?? null };
}

export async function confirmRequest(id, requester) {
  const current = await getRequest(id);
  if (current.requester !== requester) throw forbidden('not_requester', 'Only the requester can confirm');
  return settle(id, requester, 'release', [S.CODE_SUBMITTED]);
}

// ---------- Fulfiller actions ----------

export async function acceptRequest(id, fulfiller) {
  return transition(id, fulfiller, 'accepted', (data) => {
    assertStatus(data, S.OPEN);
    if (data.requester === fulfiller) throw forbidden('self_accept', 'You cannot accept your own request');
    return {
      status: S.ACCEPTED,
      fulfiller,
      acceptedAt: FieldValue.serverTimestamp(),
      fulfilDeadline: minutesFromNow(config.FULFIL_WINDOW_MINUTES),
    };
  });
}

export async function submitCode(id, fulfiller, { code, pin, sealed }) {
  if (sealed !== undefined) await assertSealedAcceptable(id, sealed);
  else if (config.VOUCHER_MODE === 'sealed') throw badRequest('sealed_required', 'Codes must be sealed in your browser before submitting');
  return transition(id, fulfiller, 'code_submitted', (data, tx) => {
    assertStatus(data, S.ACCEPTED);
    if (data.fulfiller !== fulfiller) throw forbidden('not_fulfiller', 'Only the fulfiller can submit a code');
    if (data.fulfilDeadline && data.fulfilDeadline.toMillis() < Date.now()) {
      throw conflict('fulfil_window_expired', 'The fulfil window has expired');
    }
    tx.set(voucherRef(id), {
      ...(sealed !== undefined ? { sealed } : { box: encrypt(JSON.stringify({ code, pin: pin ?? null }), id) }),
      submittedBy: fulfiller,
      submittedAt: FieldValue.serverTimestamp(),
    });
    return {
      status: S.CODE_SUBMITTED,
      codeSubmittedAt: FieldValue.serverTimestamp(),
      reviewDeadline: minutesFromNow(config.REVIEW_WINDOW_MINUTES),
    };
  });
}

// ---------- Disputes ----------

export async function disputeRequest(id, actor, reason) {
  const updated = await transition(id, actor, 'disputed', (data) => {
    assertStatus(data, S.CODE_SUBMITTED);
    if (actor !== data.requester && actor !== data.fulfiller) throw forbidden('not_party', 'Only a party to the trade can dispute');
    if (actor === data.requester && data.reviewDeadline.toMillis() < Date.now()) {
      throw conflict('review_window_expired', 'Review window has expired; funds are being auto-released');
    }
    return { status: S.DISPUTED, disputedBy: actor, disputeReason: reason, disputedAt: FieldValue.serverTimestamp() };
  });
  await Promise.all([bumpReputation(updated.requester, 'disputes'), bumpReputation(updated.fulfiller, 'disputes')]);
  return updated;
}

export async function resolveDispute(id, admin, outcome, note) {
  await transition(id, admin, 'dispute_resolved', (data) => {
    assertStatus(data, S.DISPUTED);
    return { resolution: { outcome, note: note ?? null, by: admin, at: Timestamp.now() } };
  });
  return settle(id, admin, outcome, [S.DISPUTED]);
}

// ---------- Settlement (on-chain) ----------

/**
 * Two-phase settle: lock the doc in `releasing`/`refunding` (so concurrent callers and the
 * sweeper can't double-pay), make the chain call, then commit the final state. On failure
 * the lock is rolled back to the previous status.
 */
async function settle(id, actor, kind, allowedFrom) {
  const lock = kind === 'release' ? S.RELEASING : S.REFUNDING;
  const final = kind === 'release' ? S.RELEASED : S.REFUNDED;

  const locked = await transition(id, actor, `${kind}_started`, (data) => {
    assertStatus(data, ...allowedFrom);
    if (kind === 'release' && !data.fulfiller) throw conflict('no_fulfiller', 'No fulfiller to release to');
    return { status: lock, settleFrom: data.status, settleStartedAt: Timestamp.now(), lastError: null };
  });

  let txHash;
  try {
    txHash = kind === 'release' ? await releaseEscrow(id, locked.fulfiller) : await refundEscrow(id);
  } catch (err) {
    console.error(`[settle] ${kind} ${id} failed:`, err.message);
    await transition(id, 'system', `${kind}_failed`, (data) => {
      assertStatus(data, lock);
      return { status: data.settleFrom, lastError: err.message.slice(0, 500) };
    });
    throw new HttpError(502, `${kind}_failed`, `On-chain ${kind} failed; request returned to "${locked.settleFrom}"`);
  }

  return finalizeSettle(id, actor, kind, lock, final, txHash);
}

async function finalizeSettle(id, actor, kind, lock, final, txHash) {
  const done = await transition(id, actor, kind === 'release' ? 'released' : 'refunded', (data) => {
    assertStatus(data, lock);
    return {
      status: final,
      [kind === 'release' ? 'releaseTxHash' : 'refundTxHash']: txHash,
      settledAt: FieldValue.serverTimestamp(),
    };
  });
  if (kind === 'release') {
    await Promise.all([bumpReputation(done.requester, 'completed'), bumpReputation(done.fulfiller, 'completed')]);
  }
  return done;
}

// ---------- Timeouts (called by the sweeper) ----------

const STALE_LOCK_MS = 5 * 60_000;

export async function sweep() {
  const now = Timestamp.now();
  const result = { reopened: 0, autoReleased: 0, reconciled: 0, errors: 0 };

  // 1. Fulfiller accepted but never submitted a code → reopen and strike them.
  const expiredAccepts = await col.requests.where('status', '==', S.ACCEPTED).where('fulfilDeadline', '<', now).limit(100).get();
  for (const d of expiredAccepts.docs) {
    try {
      const before = d.data().fulfiller;
      await transition(d.id, 'system', 'fulfil_timeout', (data) => {
        assertStatus(data, S.ACCEPTED);
        if (data.fulfilDeadline.toMillis() >= Date.now()) throw conflict('not_expired');
        return { status: S.OPEN, fulfiller: null, fulfilDeadline: null, acceptedAt: null };
      });
      await bumpReputation(before, 'strikes');
      result.reopened++;
    } catch (err) {
      if (err.code !== 'invalid_status' && err.code !== 'not_expired') { result.errors++; console.error('[sweep]', err.message); }
    }
  }

  // 2. Requester never confirmed/disputed → auto-release to fulfiller.
  const expiredReviews = await col.requests.where('status', '==', S.CODE_SUBMITTED).where('reviewDeadline', '<', now).limit(100).get();
  for (const d of expiredReviews.docs) {
    try {
      await settle(d.id, 'system', 'release', [S.CODE_SUBMITTED]);
      result.autoReleased++;
    } catch (err) {
      if (err.code !== 'invalid_status') { result.errors++; console.error('[sweep]', err.message); }
    }
  }

  // 3. Settle locks left behind by a crash mid-call → reconcile against chain state.
  const staleBefore = Timestamp.fromMillis(Date.now() - STALE_LOCK_MS);
  for (const [lock, kind, final] of [[S.RELEASING, 'release', S.RELEASED], [S.REFUNDING, 'refund', S.REFUNDED]]) {
    const stale = await col.requests.where('status', '==', lock).where('settleStartedAt', '<', staleBefore).limit(50).get();
    for (const d of stale.docs) {
      try {
        const onchain = await readEscrowStatus(d.id);
        if (onchain === (kind === 'release' ? 'released' : 'refunded')) {
          await finalizeSettle(d.id, 'system', kind, lock, final, 'reconciled-from-chain');
        } else {
          // Still funded (or mock): roll back so it can be retried by normal flow.
          await transition(d.id, 'system', `${kind}_lock_expired`, (data) => {
            assertStatus(data, lock);
            return { status: data.settleFrom, lastError: 'settle lock expired' };
          });
        }
        result.reconciled++;
      } catch (err) {
        result.errors++;
        console.error('[sweep]', err.message);
      }
    }
  }

  return result;
}
