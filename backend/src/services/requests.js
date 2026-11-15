import { parseUnits, verifyTypedData } from 'viem';
import { config } from '../config.js';
import { db, col, voucherRef, eventsRef, FieldValue, Timestamp, serialize } from './firestore.js';
import { escrowRefFor, escrowIdOf, quoteFee, verifyDeposit, readEscrow, settleOnChain, chainNow, isMock, publicClient } from './escrow.js';
import { encrypt, decrypt } from '../lib/crypto.js';
import { HttpError, notFound, forbidden, conflict, badRequest } from '../lib/errors.js';
import { assertSealedAcceptable } from './vault.js';
import { getForex } from '../rates/service.js';
import { READY_TYPES, READY_DEFAULT_SECONDS, READY_MAX_SECONDS, readyDomain, readyTypedData } from '../lib/ready.js';

/**
 * Lifecycle
 *
 * Who moves the money (VoucherEscrowV2): the two parties, from their own wallets. This server records what they did
 * after checking it on-chain, and sends only the calls anyone may send (timeouts) or the arbiter's ruling on a dispute.
 *
 *   spender wallet: deposit, cancel, release, dispute        buyer wallet: accept (with the spender's Ready), markDelivered
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

/** New documents use these names. Older ones still have requester / fulfiller. */
export const spenderOf = (data) => data.crypto_spender || data.requester;
export const buyerOf = (data) => ('crypto_buyer' in data ? data.crypto_buyer || null : data.fulfiller || null);

function present(id, data) {
  const rest = { ...data };
  delete rest.requester;
  delete rest.fulfiller;
  return serialize({ id, ...rest, crypto_spender: spenderOf(data), crypto_buyer: buyerOf(data) });
}

export function assertStatus(data, ...allowed) {
  if (!allowed.includes(data.status)) {
    throw conflict('invalid_status', `Request is "${data.status}"; expected ${allowed.map((s) => `"${s}"`).join(' or ')}`);
  }
}

/**
 * Read-check-write inside a Firestore transaction and append an audit event.
 * `fn(data, tx)` validates and returns the field updates. It must not do network I/O
 * other than Firestore (transactions may be retried).
 */
export async function transition(id, actor, event, fn) {
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

export function bumpReputation(address, field, by = 1) {
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
  return present(snap.id, snap.data());
}

export async function listOpen({ brand, limit = 50 }) {
  let q = col.requests.where('status', '==', S.OPEN);
  if (brand) q = q.where('brand', '==', brand);
  const snap = await q.orderBy('createdAt', 'desc').limit(limit).get();
  return snap.docs.map((d) => present(d.id, d.data()));
}

async function listByParty(field, legacy, address) {
  const [next, previous] = await Promise.all([
    col.requests.where(field, '==', address).orderBy('createdAt', 'desc').limit(100).get(),
    col.requests.where(legacy, '==', address).orderBy('createdAt', 'desc').limit(100).get(),
  ]);
  const byId = new Map();
  for (const doc of [...previous.docs, ...next.docs]) byId.set(doc.id, doc);
  return [...byId.values()].map((doc) => present(doc.id, doc.data()));
}

export async function listMine(address) {
  const [asCryptoSpender, asCryptoBuyer] = await Promise.all([
    listByParty('crypto_spender', 'requester', address),
    listByParty('crypto_buyer', 'fulfiller', address),
  ]);
  return { asCryptoSpender, asCryptoBuyer };
}

// ---------- Requester actions ----------

/**
 * The INR and USDC amounts of an order are typed by the spender. Refuse a pair that is far from the live USD/INR rate:
 * it is almost always a slip of the finger (Rs 10,000 for 1 USDC), and otherwise an attempt to mislead the buyer.
 * The two parties still choose their own rate inside the band.
 */
async function assertRateSane(amountInr, amountUsdc) {
  const maxPct = config.RATE_MAX_DEVIATION_PCT;
  if (!maxPct) return;
  let market;
  try {
    market = (await getForex()).rate;
  } catch (err) {
    console.error('[rate-check] no live USD/INR rate, order allowed unchecked:', err.message);
    return;
  }
  const implied = amountInr / Number(amountUsdc);
  const deviation = Math.abs(implied - market) / market * 100;
  if (deviation > maxPct) {
    throw badRequest('rate_out_of_range', `This order prices 1 USDC at Rs ${implied.toFixed(2)}, but the market is about Rs ${market.toFixed(2)}. Orders must be within ${maxPct}% of the market rate.`, {
      impliedRate: Number(implied.toFixed(4)), marketRate: market, maxDeviationPct: maxPct,
    });
  }
}

export async function createRequest(requester, { brand, amountInr, amountUsdc }) {
  const ref = col.requests.doc();
  // amountUsdc is what the buyer receives. The escrow pulls the fee on top of it.
  const amount = parseUnits(amountUsdc, config.USDC_DECIMALS);
  if (amount <= 0n) throw new HttpError(400, 'invalid_amount', 'amountUsdc must be > 0');
  await assertRateSane(amountInr, amountUsdc);
  const fee = await quoteFee(amount);
  const amountUsdcBaseUnits = amount.toString();
  const escrowRef = escrowRefFor(ref.id);

  const doc = {
    crypto_spender: requester,
    crypto_buyer: null,
    brand,
    amountInr,
    amountUsdc,
    amountUsdcBaseUnits,
    feeUsdcBaseUnits: fee.toString(),
    totalUsdcBaseUnits: (amount + fee).toString(),
    escrowRef, // what the wallet passes to deposit()
    escrowId: escrowIdOf(requester, escrowRef), // the on-chain id, used by every later call and read
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
  if (current.crypto_spender !== requester) throw forbidden('not_requester', 'Only the crypto spender can fund this request');
  assertStatus(current, S.PENDING_FUNDING);

  // Chain check happens outside the transaction; the transaction re-checks status.
  await verifyDeposit({ id: current.escrowId, depositor: requester, amountBaseUnits: current.amountUsdcBaseUnits, txHash });

  return transition(id, requester, 'funded', (data) => {
    assertStatus(data, S.PENDING_FUNDING);
    return { status: S.OPEN, escrowTxHash: txHash, fundedAt: FieldValue.serverTimestamp() };
  });
}

export async function cancelRequest(id, requester) {
  const current = await getRequest(id);
  if (current.crypto_spender !== requester) throw forbidden('not_requester', 'Only the crypto spender can cancel');

  if (current.status === S.PENDING_FUNDING) {
    return transition(id, requester, 'cancelled', (data) => {
      assertStatus(data, S.PENDING_FUNDING);
      return { status: S.CANCELLED };
    });
  }
  // Funded but nobody has accepted yet. The spender sends cancel() from their wallet; this records it.
  return settle(id, requester, 'refund', [S.OPEN]);
}

export async function getVoucher(id, viewer, { isAdmin = false } = {}) {
  const current = await getRequest(id);
  const allowedViewer = viewer === current.crypto_spender || (isAdmin && current.status === S.DISPUTED);
  if (!allowedViewer) throw forbidden('not_requester', 'Only the crypto spender can view the voucher');
  assertStatus(current, S.CODE_SUBMITTED, S.DISPUTED, S.RELEASING, S.RELEASED);

  const snap = await voucherRef(id).get();
  if (!snap.exists) throw notFound('Voucher not found');
  const stored = snap.data();
  if (stored.sealed) {
    // Sealed: the server cannot read it. The requester (or the dispute key holder) opens it in their own browser.
    return { requestId: id, brand: current.brand, requester: current.crypto_spender, fulfiller: current.crypto_buyer, sealed: stored.sealed };
  }
  const { code, pin } = JSON.parse(decrypt(stored.box, id));
  return { requestId: id, brand: current.brand, code, pin: pin ?? null };
}

export async function confirmRequest(id, requester) {
  const current = await getRequest(id);
  if (current.crypto_spender !== requester) throw forbidden('not_requester', 'Only the crypto spender can confirm');
  // The spender sends release() from their wallet; this records it. Allowed as soon as a buyer is bound.
  return settle(id, requester, 'release', isMock ? [S.CODE_SUBMITTED] : [S.ACCEPTED, S.CODE_SUBMITTED]);
}

// ---------- "Ready" permit (spender, after a buyer accepts) ----------

/** A permit's expiry is checked by the contract against block time, so that is the clock used for it. */
const nowSeconds = async () => (isMock ? Math.floor(Date.now() / 1000) : chainNow());

/** The escrow's assignment counter. A Ready permit is only valid for the current one. */
async function escrowEpoch(escrowId) {
  const onchain = await readEscrow(escrowId);
  return onchain ? onchain.epoch : 0;
}

/** The typed data the spender's wallet should sign. Only the spender, only while a buyer has accepted. */
export async function prepareReady(id, spender) {
  const current = await getRequest(id);
  if (current.crypto_spender !== spender) throw forbidden('not_requester', 'Only the crypto spender can say they are ready');
  assertStatus(current, S.ACCEPTED);
  if (!current.crypto_buyer) throw conflict('no_buyer', 'No buyer has accepted this order');
  const validUntil = (await nowSeconds()) + READY_DEFAULT_SECONDS;
  const epoch = await escrowEpoch(current.escrowId);
  return { validUntil, typedData: readyTypedData({ escrowId: current.escrowId, fulfiller: current.crypto_buyer, epoch, validUntil }) };
}

/**
 * Store the spender's signed Ready permit so the buyer can send it to escrow.accept().
 * The signature is checked here against the exact escrow, buyer and expiry, so a permit for a different order or a
 * different buyer is refused. On-chain it is what binds the buyer: until accept() confirms, the spender can still cancel.
 */
export async function readyRequest(id, spender, { validUntil, signature }) {
  const current = await getRequest(id);
  if (current.crypto_spender !== spender) throw forbidden('not_requester', 'Only the crypto spender can say they are ready');
  assertStatus(current, S.ACCEPTED);
  const buyer = current.crypto_buyer;
  if (!buyer) throw conflict('no_buyer', 'No buyer has accepted this order');

  const now = await nowSeconds();
  if (validUntil <= now) throw badRequest('ready_expired', 'This Ready permit has already expired');
  if (validUntil > now + READY_MAX_SECONDS) throw badRequest('ready_too_long', `A Ready permit can last at most ${READY_MAX_SECONDS / 60} minutes`);

  const epoch = await escrowEpoch(current.escrowId);
  const args = { address: spender, domain: readyDomain(), types: READY_TYPES, primaryType: 'Assign', message: { id: current.escrowId, fulfiller: buyer, epoch, validUntil: BigInt(validUntil) }, signature };
  let valid = await verifyTypedData(args).catch(() => false);
  // Smart-contract wallets (ERC-1271) can only be checked on-chain.
  if (!valid && !isMock) valid = await publicClient.verifyTypedData(args).catch(() => false);
  if (!valid) throw badRequest('bad_ready_signature', 'That signature is not the spender\'s Ready permit for this order and buyer');

  return transition(id, spender, 'ready', (data) => {
    assertStatus(data, S.ACCEPTED);
    if (buyerOf(data) !== buyer) throw conflict('buyer_changed', 'The buyer changed while you were signing; sign again');
    return { ready: { validUntil, epoch, signature, signedAt: Timestamp.now() } };
  });
}

// ---------- Fulfiller actions ----------

export async function acceptRequest(id, fulfiller) {
  return transition(id, fulfiller, 'accepted', (data) => {
    assertStatus(data, S.OPEN);
    if (spenderOf(data) === fulfiller) throw forbidden('self_accept', 'You cannot accept your own request');
    return {
      status: S.ACCEPTED,
      crypto_buyer: fulfiller,
      ready: null,
      acceptedAt: FieldValue.serverTimestamp(),
      fulfilDeadline: minutesFromNow(config.FULFIL_WINDOW_MINUTES),
    };
  });
}

export async function submitCode(id, fulfiller, { code, pin, sealed }) {
  if (sealed !== undefined) await assertSealedAcceptable(id, sealed);
  else if (config.VOUCHER_MODE === 'sealed') throw badRequest('sealed_required', 'Codes must be sealed in your browser before submitting');

  // The buyer must be bound on-chain and must have started the spender's review window (markDelivered) before the
  // code leaves their hands. The chain's review deadline is the one that counts.
  let reviewDeadline = null;
  if (!isMock) {
    const current = await getRequest(id);
    assertStatus(current, S.ACCEPTED);
    if (current.crypto_buyer !== fulfiller) throw forbidden('not_fulfiller', 'Only the crypto buyer can submit a code');
    const onchain = await readEscrow(current.escrowId);
    if (onchain.fulfiller !== fulfiller) {
      throw new HttpError(409, 'not_assigned_onchain', 'Send accept() to the escrow with the spender\'s Ready permit first; until then you are not the buyer on-chain', { function: 'accept', escrowId: current.escrowId });
    }
    if (onchain.status !== 'delivered') {
      throw new HttpError(409, 'not_delivered_onchain', 'Send markDelivered() to the escrow first; it starts the spender\'s review window', { function: 'markDelivered', escrowId: current.escrowId });
    }
    reviewDeadline = Timestamp.fromMillis(onchain.deadline * 1000);
  }

  return transition(id, fulfiller, 'code_submitted', (data, tx) => {
    assertStatus(data, S.ACCEPTED);
    if (buyerOf(data) !== fulfiller) throw forbidden('not_fulfiller', 'Only the crypto buyer can submit a code');
    if (isMock && data.fulfilDeadline && data.fulfilDeadline.toMillis() < Date.now()) {
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
      reviewDeadline: reviewDeadline ?? minutesFromNow(config.REVIEW_WINDOW_MINUTES),
    };
  });
}

// ---------- Disputes live in services/disputes.js ----------

// ---------- Settlement (on-chain) ----------

/**
 * Two-phase settle: lock the doc in `releasing`/`refunding` (so concurrent callers and the sweeper don't race), ask
 * the chain (see settleOnChain: it confirms what a party already did, or sends a timeout call or the arbiter's
 * ruling), then commit the final state. On failure the lock is rolled back to the previous status.
 */
export async function settle(id, actor, kind, allowedFrom) {
  const lock = kind === 'release' ? S.RELEASING : S.REFUNDING;
  const final = kind === 'release' ? S.RELEASED : S.REFUNDED;

  const locked = await transition(id, actor, `${kind}_started`, (data) => {
    assertStatus(data, ...allowedFrom);
    if (kind === 'release' && !buyerOf(data)) throw conflict('no_fulfiller', 'No crypto buyer to release to');
    return { status: lock, settleFrom: data.status, settleStartedAt: Timestamp.now(), lastError: null };
  });

  let txHash;
  try {
    txHash = await settleOnChain({ requestId: id, depositor: locked.crypto_spender, kind, to: locked.crypto_buyer });
  } catch (err) {
    const expected = err instanceof HttpError; // e.g. the party still has to send their own transaction
    if (!expected) console.error(`[settle] ${kind} ${id} failed:`, err.message);
    await transition(id, 'system', `${kind}_failed`, (data) => {
      assertStatus(data, lock);
      return { status: data.settleFrom, lastError: expected ? null : err.message.slice(0, 500) };
    });
    if (expected) throw err;
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
    await Promise.all([bumpReputation(done.crypto_spender, 'completed'), bumpReputation(done.crypto_buyer, 'completed')]);
  }
  return done;
}

// ---------- Timeouts (called by the sweeper) ----------

const STALE_LOCK_MS = 5 * 60_000;

export async function sweep() {
  const now = Timestamp.now();
  const result = { reopened: 0, autoReleased: 0, reconciled: 0, followedChain: 0, errors: 0 };

  // 1. Fulfiller accepted but never submitted a code → reopen and strike them.
  const expiredAccepts = await col.requests.where('status', '==', S.ACCEPTED).where('fulfilDeadline', '<', now).limit(100).get();
  for (const d of expiredAccepts.docs) {
    try {
      const before = buyerOf(d.data());
      // Once the buyer is bound on-chain the order cannot go back to the book: the chain's own deadline decides (step 4).
      if (!isMock && (await readEscrow(d.data().escrowId)).fulfiller) continue;
      await transition(d.id, 'system', 'fulfil_timeout', (data) => {
        assertStatus(data, S.ACCEPTED);
        if (data.fulfilDeadline.toMillis() >= Date.now()) throw conflict('not_expired');
        return { status: S.OPEN, crypto_buyer: null, fulfiller: null, fulfilDeadline: null, acceptedAt: null, ready: null };
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
      if (err.code !== 'invalid_status' && err.code !== 'wallet_action_required') { result.errors++; console.error('[sweep]', err.message); }
    }
  }

  // 3. Settle locks left behind by a crash mid-call → reconcile against chain state.
  const staleBefore = Timestamp.fromMillis(Date.now() - STALE_LOCK_MS);
  for (const [lock, kind, final] of [[S.RELEASING, 'release', S.RELEASED], [S.REFUNDING, 'refund', S.REFUNDED]]) {
    const stale = await col.requests.where('status', '==', lock).where('settleStartedAt', '<', staleBefore).limit(50).get();
    for (const d of stale.docs) {
      try {
        const onchain = isMock ? 'unknown' : (await readEscrow(d.data().escrowId)).status;
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

  // 4. Follow the chain. The parties can act on the escrow without telling this server (release, cancel, concede), and
  //    escrows time out on-chain. Record what already happened, and send the timeout call when one is due: the refund
  //    of an expired order, or the buyer's payment once the review window has ended.
  if (!isMock) {
    const nowSec = await chainNow();
    for (const status of [S.OPEN, S.ACCEPTED, S.CODE_SUBMITTED]) {
      const live = await col.requests.where('status', '==', status).limit(100).get();
      for (const d of live.docs) {
        try {
          const onchain = await readEscrow(d.data().escrowId);
          let kind = null;
          if (onchain.status === 'released') kind = 'release';
          else if (onchain.status === 'refunded') kind = 'refund';
          else if (onchain.status === 'funded' && nowSec >= onchain.deadline) kind = 'refund';
          else if (onchain.status === 'delivered' && nowSec >= onchain.deadline) kind = 'release';
          if (!kind) continue;
          if (kind === 'release' && !buyerOf(d.data())) continue; // not a state this server can describe; leave it for a person
          await settle(d.id, 'system', kind, [status]);
          result.followedChain++;
        } catch (err) {
          if (err.code !== 'invalid_status') { result.errors++; console.error('[sweep]', err.message); }
        }
      }
    }
  }

  return result;
}
