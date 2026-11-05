/**
 * Browser-side cryptography for NetPositive. Everything here runs in WebCrypto:
 *  - vault encryption: PBKDF2-SHA256 passphrase key -> AES-256-GCM
 *  - recipient keys: ECDH P-256, published as a keccak256 commitment onchain
 *  - delivery envelopes: ephemeral ECDH + HKDF-SHA256 -> AES-256-GCM
 * No function here talks to the network.
 */
import { keccak256, type Hex } from 'viem'
import {
  ENVELOPE_VERSION,
  envelopeAad,
  fromHex,
  parseEnvelope,
  toHex,
  type DeliveryEnvelope,
} from '@/shared/envelope'

export const PBKDF2_ITERATIONS = 600_000
const VAULT_AAD = 'netpositive-vault-v1'
const HKDF_INFO = 'NetPositive/delivery/v1'

const enc = new TextEncoder()
const dec = new TextDecoder()

/** Copy into a fresh ArrayBuffer so WebCrypto always receives a plain BufferSource. */
const buf = (bytes: Uint8Array): ArrayBuffer => {
  const out = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(out).set(bytes)
  return out
}

export const randomBytes = (n: number): Uint8Array => crypto.getRandomValues(new Uint8Array(n))
export const randomHex32 = (): Hex => toHex(randomBytes(32))

export function b64encode(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += String.fromCharCode(b)
  return btoa(s)
}
export function b64decode(text: string): Uint8Array {
  const s = atob(text)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// ---------------------------------------------------------------------------
// Passphrase-encrypted blobs (vault at rest + recovery export)
// ---------------------------------------------------------------------------

export interface EncryptedBlob {
  v: 1
  kind: 'vault' | 'recovery'
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number; salt: string }
  cipher: { name: 'AES-256-GCM'; iv: string }
  ciphertext: string
}

async function deriveKey(passphrase: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', buf(enc.encode(passphrase)), 'PBKDF2', false, [
    'deriveKey',
  ])
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', hash: 'SHA-256', salt: buf(salt), iterations },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

export async function encryptWithPassphrase(
  plaintext: string,
  passphrase: string,
  kind: EncryptedBlob['kind'],
  iterations = PBKDF2_ITERATIONS,
): Promise<EncryptedBlob> {
  const salt = randomBytes(16)
  const iv = randomBytes(12)
  const key = await deriveKey(passphrase, salt, iterations)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), additionalData: buf(enc.encode(`${VAULT_AAD}:${kind}`)) },
    key,
    buf(enc.encode(plaintext)),
  )
  return {
    v: 1,
    kind,
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations, salt: b64encode(salt) },
    cipher: { name: 'AES-256-GCM', iv: b64encode(iv) },
    ciphertext: b64encode(new Uint8Array(ct)),
  }
}

export async function decryptWithPassphrase(blob: EncryptedBlob, passphrase: string): Promise<string> {
  if (blob.v !== 1 || blob.kdf.name !== 'PBKDF2' || blob.cipher.name !== 'AES-256-GCM') {
    throw new Error('Unsupported vault format')
  }
  if (!Number.isInteger(blob.kdf.iterations) || blob.kdf.iterations < 100_000 || blob.kdf.iterations > 5_000_000) {
    throw new Error('Unsafe key-derivation settings')
  }
  const key = await deriveKey(passphrase, b64decode(blob.kdf.salt), blob.kdf.iterations)
  try {
    const pt = await crypto.subtle.decrypt(
      {
        name: 'AES-GCM',
        iv: buf(b64decode(blob.cipher.iv)),
        additionalData: buf(enc.encode(`${VAULT_AAD}:${blob.kind}`)),
      },
      key,
      buf(b64decode(blob.ciphertext)),
    )
    return dec.decode(pt)
  } catch {
    throw new Error('Wrong passphrase or damaged file')
  }
}

// ---------------------------------------------------------------------------
// Recipient keys (buyer) and delivery envelopes (fulfiller -> buyer)
// ---------------------------------------------------------------------------

export interface RecipientKey {
  /** Private key as JWK. Lives only inside the encrypted vault. */
  privateJwk: JsonWebKey
  /** Uncompressed P-256 public key, 65 bytes. Safe to publish. */
  publicKey: Hex
  /** keccak256(publicKey). This is the `buyerRecipient` commitment stored onchain. */
  keyHash: Hex
}

export const recipientKeyHash = (publicKey: Hex): Hex => keccak256(publicKey)

export async function generateRecipientKey(): Promise<RecipientKey> {
  const pair = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const raw = new Uint8Array(await crypto.subtle.exportKey('raw', pair.publicKey))
  const publicKey = toHex(raw)
  return {
    privateJwk: await crypto.subtle.exportKey('jwk', pair.privateKey),
    publicKey,
    keyHash: recipientKeyHash(publicKey),
  }
}

async function importPublic(raw: Hex): Promise<CryptoKey> {
  return crypto.subtle.importKey('raw', buf(fromHex(raw)), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
}

async function deriveDeliveryKey(sharedBits: ArrayBuffer, tradeId: Hex): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey('raw', sharedBits, 'HKDF', false, ['deriveKey'])
  return crypto.subtle.deriveKey(
    { name: 'HKDF', hash: 'SHA-256', salt: buf(fromHex(tradeId)), info: buf(enc.encode(HKDF_INFO)) },
    material,
    { name: 'AES-GCM', length: 256 },
    false,
    ['encrypt', 'decrypt'],
  )
}

/** Encrypt a voucher payload to the buyer's recipient key. The plaintext never leaves this function unencrypted. */
export async function encryptDelivery(
  plaintext: string,
  tradeId: Hex,
  buyerPublicKey: Hex,
): Promise<DeliveryEnvelope> {
  const recipient = await importPublic(buyerPublicKey)
  const eph = await crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, true, ['deriveBits'])
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: recipient }, eph.privateKey, 256)
  const key = await deriveDeliveryKey(bits, tradeId)
  const iv = randomBytes(12)
  const keyHash = recipientKeyHash(buyerPublicKey)
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: buf(iv), additionalData: buf(envelopeAad(tradeId, keyHash)) },
    key,
    buf(enc.encode(plaintext)),
  )
  return {
    v: ENVELOPE_VERSION,
    tradeId,
    recipientKeyHash: keyHash,
    ephemeralPub: toHex(new Uint8Array(await crypto.subtle.exportKey('raw', eph.publicKey))),
    iv: toHex(iv),
    ciphertext: toHex(new Uint8Array(ct)),
  }
}

export async function decryptDelivery(envelope: DeliveryEnvelope, key: RecipientKey): Promise<string> {
  const env = parseEnvelope(envelope)
  if (env.recipientKeyHash !== key.keyHash) throw new Error('Envelope is addressed to a different recipient key')
  const priv = await crypto.subtle.importKey(
    'jwk',
    key.privateJwk,
    { name: 'ECDH', namedCurve: 'P-256' },
    false,
    ['deriveBits'],
  )
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: await importPublic(env.ephemeralPub) }, priv, 256)
  const aesKey = await deriveDeliveryKey(bits, env.tradeId)
  try {
    const pt = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: buf(fromHex(env.iv)), additionalData: buf(envelopeAad(env.tradeId, env.recipientKeyHash)) },
      aesKey,
      buf(fromHex(env.ciphertext)),
    )
    return dec.decode(pt)
  } catch {
    throw new Error('Envelope failed authentication: wrong key, wrong trade, or tampered ciphertext')
  }
}
