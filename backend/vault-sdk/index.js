// NetPositive voucher vault SDK. Pure ES module (no Node-only APIs): the same file runs in the browser and in Node.
// Crypto: X25519 (key agreement) + HKDF-SHA256 + AES-256-GCM, from the audited @noble libraries.
//
// Why this exists: the server must never be able to read a voucher code. A voucher is sealed in the FULFILLER's browser to the
// REQUESTER's vault public key (and optionally to an offline admin key for disputes). The server stores and relays ciphertext only.
// The requester's private key is derived in their browser from a wallet signature, so it is never stored anywhere and a database
// or server-key leak exposes no codes.
//
// Limits (be honest about them):
//  - Whoever can make the wallet sign KEY_MESSAGE can derive the vault key. Only sign it on NetPositive's own site.
//  - Some wallets (smart-contract / passkey wallets) do not produce the same signature twice; use assertDeterministicSignature().
//  - A malicious frontend served to the user could steal plaintext. This protects against server/database compromise, not that.
import { x25519 } from '@noble/curves/ed25519.js';
import { hkdf } from '@noble/hashes/hkdf.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { gcm } from '@noble/ciphers/aes.js';

export const VERSION = 1;
export const ALG = 'x25519-hkdf-sha256+aes256gcm';
export const KEY_MESSAGE =
  'NetPositive vault key v1\n\nSign to unlock your voucher vault. This costs no gas and moves no funds.\nOnly sign this on NetPositive sites: anyone who gets this signature can read your vouchers.';
export const MAX_RECIPIENTS = 3; // requester, optional admin, optional spare
export const MAX_CIPHERTEXT_BYTES = 2048;
const PAD = 128;
const enc = new TextEncoder();
const dec = new TextDecoder();

// ---------- encoding helpers (browser + Node) ----------
export const toHex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, '0')).join('');
export function fromHex(hex) {
  const h = String(hex).replace(/^0x/, '');
  if (!/^([0-9a-fA-F]{2})*$/.test(h)) throw new Error('invalid hex');
  return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
}
export const toB64 = (u8) => btoa(String.fromCharCode(...u8));
export function fromB64(s) {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s) || s.length % 4 !== 0) throw new Error('invalid base64');
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
}
const rand = (n) => globalThis.crypto.getRandomValues(new Uint8Array(n));
const concat = (...a) => { const o = new Uint8Array(a.reduce((n, x) => n + x.length, 0)); let i = 0; for (const x of a) { o.set(x, i); i += x.length; } return o; };

// ---------- keys ----------
/** Fingerprint of a public key (first 16 hex of sha256). Used to name which key an envelope was sealed to. */
export const keyId = (publicKeyHex) => toHex(sha256(fromHex(publicKeyHex))).slice(0, 16);

/** Message the user signs to prove that this vault public key is theirs (stops the server substituting a key). */
export const keyBindingMessage = (address, publicKeyHex) =>
  `NetPositive vault public key v1\naddress: ${address.toLowerCase()}\nkey: ${publicKeyHex.toLowerCase()}`;

/** Binds an envelope to one voucher in one trade so it cannot be copied onto another request. */
export const voucherAad = (requestId, requester, fulfiller) =>
  `netpositive:voucher:v1:${requestId}:${requester.toLowerCase()}:${fulfiller.toLowerCase()}`;

/** Wallets must sign KEY_MESSAGE the same way twice, otherwise the vault key would change and vouchers be lost. */
export function assertDeterministicSignature(sigA, sigB) {
  if (String(sigA).toLowerCase() !== String(sigB).toLowerCase()) {
    throw new Error('This wallet signs non-deterministically, so a wallet-derived vault key would be lost. Use a recovery passphrase instead.');
  }
}

/** Derive the vault keys from the wallet's signature of KEY_MESSAGE. Nothing here is ever sent to the server. */
export function deriveVaultKeys(signatureHex) {
  const sig = fromHex(signatureHex);
  if (sig.length < 64) throw new Error('signature too short');
  const salt = enc.encode('netpositive-vault-v1');
  const privateKey = hkdf(sha256, sig, salt, enc.encode('x25519-private'), 32);
  const stateKey = hkdf(sha256, sig, salt, enc.encode('state-aes256'), 32);
  const publicKey = x25519.getPublicKey(privateKey);
  return { privateKey, publicKey, publicKeyHex: toHex(publicKey), stateKey };
}

// ---------- padding (hides the code length) ----------
function pad(bytes) {
  const total = Math.max(PAD, Math.ceil((bytes.length + 2) / PAD) * PAD);
  const out = new Uint8Array(total);
  out[0] = (bytes.length >> 8) & 0xff; out[1] = bytes.length & 0xff;
  out.set(bytes, 2);
  return out;
}
function unpad(padded) {
  const len = (padded[0] << 8) | padded[1];
  if (len + 2 > padded.length) throw new Error('bad padding');
  return padded.slice(2, 2 + len);
}

// ---------- seal / open ----------
const wrapKeyFor = (shared, epk, rpk) => hkdf(sha256, shared, concat(epk, rpk), enc.encode('netpositive-vault-wrap-v1'), 32);

/**
 * Seal a JSON-serialisable payload (e.g. {code, pin}) to one or more recipients.
 * recipients: array of public keys (hex). aad: string from voucherAad().
 * Returns a JSON-safe envelope. One ciphertext, one wrapped key per recipient.
 */
export function seal(payload, recipientPublicKeys, aad) {
  if (!Array.isArray(recipientPublicKeys) || recipientPublicKeys.length < 1 || recipientPublicKeys.length > MAX_RECIPIENTS) {
    throw new Error(`1 to ${MAX_RECIPIENTS} recipients required`);
  }
  const aadBytes = enc.encode(aad);
  const dek = rand(32);
  const iv = rand(12);
  const ct = gcm(dek, iv, aadBytes).encrypt(pad(enc.encode(JSON.stringify(payload))));
  if (ct.length > MAX_CIPHERTEXT_BYTES) throw new Error('payload too large');
  const recipients = recipientPublicKeys.map((pkHex) => {
    const rpk = fromHex(pkHex);
    if (rpk.length !== 32) throw new Error('recipient key must be 32 bytes');
    const esk = x25519.utils.randomPrivateKey();
    const epk = x25519.getPublicKey(esk);
    const wrapKey = wrapKeyFor(x25519.getSharedSecret(esk, rpk), epk, rpk);
    const wiv = rand(12);
    return { kid: keyId(pkHex), epk: toB64(epk), iv: toB64(wiv), wrapped: toB64(gcm(wrapKey, wiv, aadBytes).encrypt(dek)) };
  });
  return { v: VERSION, alg: ALG, iv: toB64(iv), ct: toB64(ct), recipients };
}

/** Open an envelope with a recipient's private key. Throws if the key, aad or any byte is wrong. */
export function open(envelope, privateKey, aad) {
  validateEnvelope(envelope);
  const myPub = x25519.getPublicKey(privateKey);
  const kid = keyId(toHex(myPub));
  const entry = envelope.recipients.find((r) => r.kid === kid);
  if (!entry) throw new Error('This envelope was not sealed to your key');
  const aadBytes = enc.encode(aad);
  const epk = fromB64(entry.epk);
  const wrapKey = wrapKeyFor(x25519.getSharedSecret(privateKey, epk), epk, myPub);
  const dek = gcm(wrapKey, fromB64(entry.iv), aadBytes).decrypt(fromB64(entry.wrapped));
  const plain = gcm(dek, fromB64(envelope.iv), aadBytes).decrypt(fromB64(envelope.ct));
  return JSON.parse(dec.decode(unpad(plain)));
}

/** Strict shape check, used by the server before storing and by clients before opening. Throws on anything unexpected. */
export function validateEnvelope(e) {
  const bad = (m) => { throw new Error(`invalid envelope: ${m}`); };
  if (!e || typeof e !== 'object' || Array.isArray(e)) bad('not an object');
  if (e.v !== VERSION || e.alg !== ALG) bad('unsupported version/alg');
  const keys = Object.keys(e).sort().join();
  if (keys !== 'alg,ct,iv,recipients,v') bad('unexpected fields');
  if (fromB64(e.iv).length !== 12) bad('iv');
  const ctLen = fromB64(e.ct).length;
  if (ctLen < PAD + 16 || ctLen > MAX_CIPHERTEXT_BYTES) bad('ciphertext size');
  if (!Array.isArray(e.recipients) || e.recipients.length < 1 || e.recipients.length > MAX_RECIPIENTS) bad('recipients');
  const seen = new Set();
  for (const r of e.recipients) {
    if (!r || typeof r !== 'object' || Object.keys(r).sort().join() !== 'epk,iv,kid,wrapped') bad('recipient fields');
    if (!/^[0-9a-f]{16}$/.test(r.kid) || seen.has(r.kid)) bad('recipient kid');
    seen.add(r.kid);
    if (fromB64(r.epk).length !== 32 || fromB64(r.iv).length !== 12 || fromB64(r.wrapped).length !== 48) bad('recipient sizes');
  }
  return true;
}

// ---------- private vault state (e.g. "redeemed", notes) ----------
/** Encrypt the requester's own vault metadata with a key only they hold. The server stores the blob opaquely. */
export function encryptState(obj, stateKey, aad) {
  const iv = rand(12);
  return { v: VERSION, iv: toB64(iv), ct: toB64(gcm(stateKey, iv, enc.encode(aad)).encrypt(pad(enc.encode(JSON.stringify(obj))))) };
}
export function decryptState(blob, stateKey, aad) {
  return JSON.parse(dec.decode(unpad(gcm(stateKey, fromB64(blob.iv), enc.encode(aad)).decrypt(fromB64(blob.ct)))));
}
export const stateAad = (requestId, owner) => `netpositive:vault-state:v1:${requestId}:${owner.toLowerCase()}`;
export function validateStateBlob(b) {
  const bad = (m) => { throw new Error(`invalid state blob: ${m}`); };
  if (!b || typeof b !== 'object' || Object.keys(b).sort().join() !== 'ct,iv,v' || b.v !== VERSION) bad('shape');
  if (fromB64(b.iv).length !== 12) bad('iv');
  const n = fromB64(b.ct).length;
  if (n < PAD + 16 || n > 1024) bad('size');
  return true;
}
