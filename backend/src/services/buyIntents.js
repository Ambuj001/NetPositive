import { col, FieldValue, Timestamp, serialize } from './firestore.js';
import { notFound } from '../lib/errors.js';

/**
 * Buy intents: a crypto buyer says "I want to buy USDC for this INR amount, using this voucher (or none)".
 * They are shown as recommendations to people who want to spend crypto, matched on amount and voucher.
 *
 *   buyIntents/{address}  { id, crypto_buyer, amountInr, voucher: brand | null, status: 'active', createdAt, updatedAt, expiresAt }
 *
 * One document per wallet: posting again replaces the previous intent, so a buyer who keeps changing the amount
 * never leaves a pile of stale entries. Intents expire on their own (INTENT_TTL_HOURS).
 */
export const INTENT_TTL_HOURS = 24;

const PUBLIC_FIELDS = ['id', 'crypto_buyer', 'amountInr', 'voucher', 'createdAt', 'expiresAt'];

function present(data) {
  const out = {};
  for (const k of PUBLIC_FIELDS) out[k] = data[k] ?? null;
  return serialize(out);
}

const isLive = (data, now = Date.now()) => data.status === 'active' && data.expiresAt && data.expiresAt.toMillis() > now;

/** Create or replace the buyer's intent. `voucher` is a brand id, or null for "no voucher". */
export async function upsertIntent(address, { amountInr, voucher }) {
  const ref = col.buyIntents.doc(address);
  const expiresAt = Timestamp.fromMillis(Date.now() + INTENT_TTL_HOURS * 3_600_000);
  const prev = await ref.get();
  await ref.set({
    id: address,
    crypto_buyer: address,
    amountInr,
    voucher: voucher ?? null,
    status: 'active',
    // keep the original posting time while the intent is still live, so "posted X ago" doesn't jump on every edit
    createdAt: prev.exists && isLive(prev.data()) ? prev.data().createdAt : FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    expiresAt,
  });
  return getIntent(address);
}

export async function getIntent(address) {
  const snap = await col.buyIntents.doc(address).get();
  if (!snap.exists || !isLive(snap.data())) return null;
  return present(snap.data());
}

export async function cancelIntent(address) {
  const ref = col.buyIntents.doc(address);
  const snap = await ref.get();
  if (!snap.exists || snap.data().status !== 'active') throw notFound('You have no active buy request');
  await ref.update({ status: 'cancelled', updatedAt: FieldValue.serverTimestamp() });
}

/**
 * Active intents for an INR amount. With a `brand`, an intent matches when it names that voucher or names none.
 * Without a `brand`, the amount alone decides. Oldest first, so the longest-waiting buyer is listed first.
 */
export async function listMatching({ amountInr, brand, limit = 20 }) {
  // Two equality filters need no composite index; voucher, expiry and ordering are done here.
  const snap = await col.buyIntents.where('status', '==', 'active').where('amountInr', '==', amountInr).limit(100).get();
  const now = Date.now();
  return snap.docs
    .map((d) => d.data())
    .filter((d) => isLive(d, now) && (!brand || d.voucher === null || d.voucher === brand))
    .sort((a, b) => a.createdAt.toMillis() - b.createdAt.toMillis())
    .slice(0, limit)
    .map(present);
}
