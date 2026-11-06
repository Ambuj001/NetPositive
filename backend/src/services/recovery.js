import { config } from '../config.js';
import { col, db, FieldValue, Timestamp, serialize } from './firestore.js';
import { verifyProof } from './worldid.js';
import { rebindParties } from './requests.js';
import { HttpError, forbidden, conflict, notFound } from '../lib/errors.js';

/**
 * Lose your wallet, not your money.
 *
 * A person who lost their wallet signs in with a NEW wallet and proves they are the same human (World ID
 * returns the same nullifier for the same person and action). After a waiting period, their account, reputation
 * and live trades move to the new wallet. The old wallet can cancel during the wait (if it is still theirs).
 *
 *   start (new wallet + World ID) ──wait RECOVERY_DELAY_MINUTES──▶ complete ──▶ trades rebound, escrow refunds
 *        │                                                                      go to the new wallet
 *        └──▶ cancel (old wallet)
 *
 * Trust note: the escrow contract records the OLD wallet as depositor and cannot be changed. Refunds to the new
 * wallet therefore go through the operator's release(), the same operator who can already release any escrow.
 * Until recovery completes, anyone can still trigger the contract's timeout refund to the old wallet after 7 days.
 */

const ref = (id) => col.recoveries.doc(id);

export async function startRecovery(newAddress, user, body) {
  if (user.worldIdNullifier) {
    throw conflict('wallet_already_verified', 'This wallet already has a World ID; recover from a wallet that does not');
  }
  const { nullifier } = await verifyProof(newAddress, body);

  const nullSnap = await col.nullifiers.doc(nullifier).get();
  if (!nullSnap.exists) throw new HttpError(404, 'no_account_to_recover', 'No NetPositive account is linked to this World ID');
  const human = nullSnap.data();
  if (human.banned) throw forbidden('human_banned', 'This person is banned from NetPositive');
  if (human.address === newAddress) throw new HttpError(400, 'already_your_account', 'This wallet already owns that account');

  const prior = await col.recoveries.where('nullifier', '==', nullifier).get();
  if (prior.docs.some((d) => ['pending', 'completing'].includes(d.data().status))) {
    throw conflict('recovery_pending', 'A recovery for this person is already in progress');
  }

  const r = col.recoveries.doc();
  await r.create({
    nullifier,
    oldAddress: human.address,
    newAddress,
    status: 'pending',
    startedAt: FieldValue.serverTimestamp(),
    executeAfter: Timestamp.fromMillis(Date.now() + config.RECOVERY_DELAY_MINUTES * 60_000),
  });
  return serialize({ id: r.id, ...(await r.get()).data() });
}

/** The old wallet (if it is still in the owner's hands) can stop a recovery during the waiting period. */
export async function cancelRecovery(address, id) {
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref(id));
    if (!snap.exists) throw notFound('Recovery not found');
    const d = snap.data();
    if (d.oldAddress !== address) throw forbidden('not_old_wallet', 'Only the wallet being recovered can cancel');
    if (d.status !== 'pending') throw conflict('invalid_status', `Recovery is "${d.status}"`);
    tx.update(ref(id), { status: 'cancelled', cancelledAt: FieldValue.serverTimestamp() });
  });
  return serialize({ id, ...(await ref(id).get()).data() });
}

export async function completeRecovery(address, id) {
  const snap = await ref(id).get();
  if (!snap.exists) throw notFound('Recovery not found');
  const rec = snap.data();
  if (rec.newAddress !== address) throw forbidden('not_new_wallet', 'Only the new wallet can complete recovery');
  if (!['pending', 'completing'].includes(rec.status)) throw conflict('invalid_status', `Recovery is "${rec.status}"`);
  if (rec.executeAfter.toMillis() > Date.now()) {
    throw conflict('recovery_too_early', `Waiting period ends at ${rec.executeAfter.toDate().toISOString()}`);
  }

  // Claim it (so two completes cannot run at once), then move the trades, then switch the identity.
  await db.runTransaction(async (tx) => {
    const s = await tx.get(ref(id));
    if (!['pending', 'completing'].includes(s.data().status)) throw conflict('invalid_status', 'Recovery changed');
    tx.update(ref(id), { status: 'completing' });
  });

  const moved = await rebindParties(rec.oldAddress, rec.newAddress); // idempotent; throws if a settlement is mid-flight

  await db.runTransaction(async (tx) => {
    const nullRef = col.nullifiers.doc(rec.nullifier);
    const [nullSnap, oldSnap, newSnap] = await Promise.all([
      tx.get(nullRef),
      tx.get(col.users.doc(rec.oldAddress)),
      tx.get(col.users.doc(rec.newAddress)),
    ]);
    const human = nullSnap.data();
    if (!nullSnap.exists || human.banned) throw forbidden('human_banned', 'This person is banned from NetPositive');
    if (human.address !== rec.oldAddress && human.address !== rec.newAddress) {
      throw conflict('recovery_stale', 'The account moved since this recovery started');
    }
    if (newSnap.data()?.worldIdNullifier && newSnap.data().worldIdNullifier !== rec.nullifier) {
      throw conflict('wallet_already_verified', 'The new wallet is linked to a different World ID');
    }
    const old = oldSnap.data() ?? {};
    tx.update(nullRef, {
      address: rec.newAddress,
      previousAddresses: [...new Set([...(human.previousAddresses ?? []), rec.oldAddress])],
    });
    tx.update(col.users.doc(rec.newAddress), {
      worldIdNullifier: rec.nullifier,
      verificationLevel: old.verificationLevel ?? human.verificationLevel,
      worldIdVerifiedAt: FieldValue.serverTimestamp(),
      ...(old.reputation && { reputation: old.reputation }), // reputation belongs to the human
    });
    if (oldSnap.exists) {
      tx.update(col.users.doc(rec.oldAddress), { worldIdNullifier: null, recoveredTo: rec.newAddress, recoveredAt: FieldValue.serverTimestamp() });
    }
    tx.update(ref(id), { status: 'completed', completedAt: FieldValue.serverTimestamp(), moved });
  });

  return serialize({ id, ...(await ref(id).get()).data() });
}

export async function listRecoveries(address) {
  const [asNew, asOld] = await Promise.all([
    col.recoveries.where('newAddress', '==', address).limit(20).get(),
    col.recoveries.where('oldAddress', '==', address).limit(20).get(),
  ]);
  const fmt = (d) => serialize({ id: d.id, ...d.data() });
  return { asNewWallet: asNew.docs.map(fmt), asOldWallet: asOld.docs.map(fmt) };
}
