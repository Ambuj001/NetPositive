import { col, db, FieldValue, serialize } from './firestore.js';
import { forbidden, conflict } from '../lib/errors.js';

/**
 * A "human" is a World ID nullifier. worldIdNullifiers/{nullifier} records which wallet currently
 * speaks for that human, every wallet it used before (recovery), and whether the human is banned.
 * Banning works on the nullifier, so a banned person cannot come back with a new wallet.
 */

/** Bind a verified human to a wallet (first-time sign-up). Idempotent for the same wallet. */
export async function bindHuman(address, { nullifier, level }) {
  const nullRef = col.nullifiers.doc(nullifier);
  const userRef = col.users.doc(address);

  await db.runTransaction(async (tx) => {
    const [nullSnap, userSnap] = await Promise.all([tx.get(nullRef), tx.get(userRef)]);
    const known = nullSnap.exists ? nullSnap.data() : null;

    if (known?.banned) throw forbidden('human_banned', 'This person is banned from NetPositive');
    if (known && known.address !== address) {
      throw conflict(
        'world_id_already_used',
        'This World ID already has an account on another wallet. If you lost that wallet, use wallet recovery.',
      );
    }
    const existing = userSnap.data()?.worldIdNullifier;
    if (existing && existing !== nullifier) {
      throw conflict('wallet_already_verified', 'This wallet is already linked to a different World ID');
    }
    if (known) return; // already bound to this wallet

    tx.create(nullRef, {
      address,
      previousAddresses: [],
      verificationLevel: level,
      banned: false,
      createdAt: FieldValue.serverTimestamp(),
    });
    tx.update(userRef, { worldIdNullifier: nullifier, verificationLevel: level, worldIdVerifiedAt: FieldValue.serverTimestamp() });
  });

  return serialize((await userRef.get()).data());
}

/**
 * Ban the HUMAN behind a wallet: the nullifier, the current wallet and every wallet that human used before.
 * Returns { nullifier, wallets }.
 */
export async function banHuman(address, { reason, requestId, by }) {
  return db.runTransaction(async (tx) => {
    const userRef = col.users.doc(address);
    const userSnap = await tx.get(userRef);
    const nullifier = userSnap.data()?.worldIdNullifier ?? null;
    const nullRef = nullifier ? col.nullifiers.doc(nullifier) : null;
    const nullSnap = nullRef ? await tx.get(nullRef) : null;

    const wallets = new Set([address, ...(nullSnap?.data()?.previousAddresses ?? [])]);
    if (nullSnap?.exists) wallets.add(nullSnap.data().address);
    const refs = [...wallets].map((w) => col.users.doc(w));
    const snaps = await Promise.all(refs.map((r) => tx.get(r)));

    const mark = { banned: true, bannedReason: reason, bannedRequestId: requestId ?? null, bannedBy: by ?? null, bannedAt: FieldValue.serverTimestamp() };
    if (nullSnap?.exists) tx.update(nullRef, mark);
    snaps.forEach((s, i) => { if (s.exists) tx.update(refs[i], mark); });
    return { nullifier, wallets: [...wallets] };
  });
}
