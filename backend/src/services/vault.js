import { recoverMessageAddress } from 'viem';
import { config } from '../config.js';
import { db, col, voucherRef, FieldValue, serialize } from './firestore.js';
import { badRequest, conflict, forbidden, notFound } from '../lib/errors.js';
import * as V from '../../vault-sdk/index.js';

/**
 * Voucher vault. The server stores ciphertext and public keys only; it can never read a voucher code.
 *
 *   users/{address}.vaultKey                  { publicKey, kid, signature, registeredAt }  (public by nature)
 *   requests/{id}/private/voucher             { sealed: <envelope> }  (legacy: { box })
 *   users/{address}/vaultState/{requestId}    { blob }  opaque, encrypted by the owner's own key
 */
const HAS_VOUCHER = new Set(['code_submitted', 'disputed', 'releasing', 'released']);
export const adminKid = () => (config.ADMIN_VAULT_PUBLIC_KEY ? V.keyId(config.ADMIN_VAULT_PUBLIC_KEY) : null);

export function vaultConfig() {
  return {
    mode: config.VOUCHER_MODE,
    envelopeVersion: V.VERSION,
    keyMessage: V.KEY_MESSAGE,
    adminPublicKey: config.ADMIN_VAULT_PUBLIC_KEY || null, // clients seal to this as well, so a dispute can be judged
  };
}

/** Register the caller's vault public key. The wallet must sign the key, so a stolen login token cannot plant a key. */
export async function registerKey(address, { publicKey, signature }) {
  const pk = publicKey.toLowerCase();
  const recovered = await recoverMessageAddress({ message: V.keyBindingMessage(address, pk), signature }).catch(() => null);
  if (!recovered || recovered.toLowerCase() !== address) throw badRequest('bad_key_signature', 'The signature does not prove this key belongs to your wallet');
  const ref = col.users.doc(address);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw notFound('Unknown user');
    const existing = snap.data().vaultKey;
    if (existing) {
      if (existing.publicKey === pk) return; // idempotent
      throw conflict('vault_key_exists', 'A different vault key is already registered; it cannot be replaced');
    }
    tx.update(ref, { vaultKey: { publicKey: pk, kid: V.keyId(pk), signature, registeredAt: FieldValue.serverTimestamp() } });
  });
  return getKey(address);
}

export async function getKey(address) {
  const snap = await col.users.doc(address.toLowerCase()).get();
  const k = snap.exists ? snap.data().vaultKey : null;
  if (!k) throw notFound('This user has not set up a voucher vault yet');
  return serialize({ address: address.toLowerCase(), publicKey: k.publicKey, kid: k.kid, signature: k.signature });
}

// Documents written since the rename use crypto_spender / crypto_buyer; older ones still have requester / fulfiller.
const spenderOf = (d) => d.crypto_spender || d.requester;
const buyerOf = (d) => ('crypto_buyer' in d ? d.crypto_buyer || null : d.fulfiller || null);

/** Called before a sealed code is stored: it must be well-formed and sealed to the requester (and the admin key, if configured). */
export async function assertSealedAcceptable(requestId, sealed) {
  if (config.VOUCHER_MODE === 'legacy') throw badRequest('sealed_not_enabled', 'Sealed vouchers are not enabled');
  try { V.validateEnvelope(sealed); } catch (e) { throw badRequest('bad_envelope', e.message); }
  const reqSnap = await col.requests.doc(requestId).get();
  if (!reqSnap.exists) throw notFound('Request not found');
  const userSnap = await col.users.doc(spenderOf(reqSnap.data())).get();
  const key = userSnap.data()?.vaultKey;
  if (!key) throw conflict('requester_vault_key_missing', 'The requester has not set up a voucher vault, so the code cannot be sealed to them');
  const kids = sealed.recipients.map((r) => r.kid);
  if (!kids.includes(key.kid)) throw badRequest('not_sealed_to_requester', 'The envelope is not sealed to the requester\'s vault key');
  const a = adminKid();
  if (a && !kids.includes(a)) throw badRequest('not_sealed_to_admin', 'The envelope must also be sealed to the dispute key');
}

/** All the caller's received vouchers (as requester): sealed envelopes plus their own opaque state. */
export async function listVault(address) {
  const [next, previous] = await Promise.all([
    col.requests.where('crypto_spender', '==', address).orderBy('createdAt', 'desc').limit(100).get(),
    col.requests.where('requester', '==', address).orderBy('createdAt', 'desc').limit(100).get(),
  ]);
  const byId = new Map();
  for (const doc of [...previous.docs, ...next.docs]) byId.set(doc.id, doc);
  const docs = [...byId.values()].sort((a, b) => (b.data().createdAt?.toMillis?.() ?? 0) - (a.data().createdAt?.toMillis?.() ?? 0));
  const items = [];
  for (const d of docs) {
    const r = d.data();
    if (!HAS_VOUCHER.has(r.status)) continue;
    const [v, s] = await Promise.all([voucherRef(d.id).get(), col.users.doc(address).collection('vaultState').doc(d.id).get()]);
    if (!v.exists) continue;
    const vd = v.data();
    items.push(serialize({
      requestId: d.id, brand: r.brand, amountInr: r.amountInr, status: r.status, requester: spenderOf(r), fulfiller: buyerOf(r), // names kept: the sealed-box AAD is built from these two addresses
      codeSubmittedAt: r.codeSubmittedAt ?? null,
      sealed: vd.sealed ?? null,
      legacy: vd.sealed ? undefined : true, // plaintext-era voucher: fetch it with GET /requests/:id/voucher
      state: s.exists ? s.data().blob : null,
    }));
  }
  return { items };
}

export async function putState(address, requestId, blob) {
  try { V.validateStateBlob(blob); } catch (e) { throw badRequest('bad_state_blob', e.message); }
  const reqSnap = await col.requests.doc(requestId).get();
  if (!reqSnap.exists) throw notFound('Request not found');
  if (spenderOf(reqSnap.data()) !== address) throw forbidden('not_requester', 'Only the requester has a vault entry for this request');
  if (!HAS_VOUCHER.has(reqSnap.data().status)) throw conflict('no_voucher_yet', 'No voucher has been submitted for this request');
  await col.users.doc(address).collection('vaultState').doc(requestId).set({ blob, updatedAt: FieldValue.serverTimestamp() });
  return { ok: true };
}
