/**
 * Encrypted-delivery envelope: the ONLY voucher-related object that ever leaves the browser.
 * It carries ciphertext, never plaintext. The backend validates its shape and stores it by digest.
 */
import { bytesToHex, concatHex, hexToBytes, isHex, keccak256, stringToHex, type Hex } from 'viem'

export const ENVELOPE_VERSION = 1 as const
export const ENVELOPE_DOMAIN_TAG = 'NetPositive/envelope/v1'
/** P-256 uncompressed public key: 0x04 || X || Y. */
export const PUBKEY_BYTES = 65
export const IV_BYTES = 12
export const GCM_TAG_BYTES = 16
export const MAX_CIPHERTEXT_BYTES = 8 * 1024

export interface DeliveryEnvelope {
  v: typeof ENVELOPE_VERSION
  tradeId: Hex
  /** keccak256 of the buyer's recipient public key, as committed onchain at order creation. */
  recipientKeyHash: Hex
  /** Sender's one-time P-256 public key (uncompressed). */
  ephemeralPub: Hex
  iv: Hex
  /** AES-256-GCM ciphertext including the 16-byte tag. */
  ciphertext: Hex
}

const ENVELOPE_KEYS: ReadonlyArray<keyof DeliveryEnvelope> = [
  'v',
  'tradeId',
  'recipientKeyHash',
  'ephemeralPub',
  'iv',
  'ciphertext',
]

const hexOfLength = (value: unknown, bytes: number): value is Hex =>
  typeof value === 'string' && isHex(value, { strict: true }) && hexToBytes(value).length === bytes

/** Strict parser: unknown keys, wrong sizes, or non-hex values are rejected, so stray plaintext fields cannot ride along. */
export function parseEnvelope(input: unknown): DeliveryEnvelope {
  if (typeof input !== 'object' || input === null || Array.isArray(input)) {
    throw new Error('Envelope must be an object')
  }
  const record = input as Record<string, unknown>
  const extra = Object.keys(record).filter((k) => !(ENVELOPE_KEYS as readonly string[]).includes(k))
  if (extra.length > 0) throw new Error('Envelope has unexpected fields')
  if (record.v !== ENVELOPE_VERSION) throw new Error('Unsupported envelope version')
  if (!hexOfLength(record.tradeId, 32)) throw new Error('Bad tradeId')
  if (!hexOfLength(record.recipientKeyHash, 32)) throw new Error('Bad recipientKeyHash')
  if (!hexOfLength(record.ephemeralPub, PUBKEY_BYTES)) throw new Error('Bad ephemeralPub')
  if (!hexOfLength(record.iv, IV_BYTES)) throw new Error('Bad iv')
  const ct = record.ciphertext
  if (typeof ct !== 'string' || !isHex(ct, { strict: true })) throw new Error('Bad ciphertext')
  const ctLen = hexToBytes(ct).length
  if (ctLen <= GCM_TAG_BYTES || ctLen > MAX_CIPHERTEXT_BYTES) throw new Error('Ciphertext size out of range')
  return {
    v: ENVELOPE_VERSION,
    tradeId: record.tradeId,
    recipientKeyHash: record.recipientKeyHash,
    ephemeralPub: record.ephemeralPub,
    iv: record.iv,
    ciphertext: ct,
  }
}

/** Commitment that the delivery attestation signs and the contract stores as deliveryDigest. */
export function envelopeDigest(env: DeliveryEnvelope): Hex {
  return keccak256(
    concatHex([
      stringToHex(ENVELOPE_DOMAIN_TAG),
      env.tradeId,
      env.recipientKeyHash,
      env.ephemeralPub,
      env.iv,
      env.ciphertext,
    ]),
  )
}

/** Binds the AES-GCM ciphertext to this trade and recipient so it cannot be replayed into another order. */
export function envelopeAad(tradeId: Hex, recipientKeyHash: Hex): Uint8Array {
  return hexToBytes(concatHex([tradeId, recipientKeyHash]))
}

export const toHex = (bytes: Uint8Array): Hex => bytesToHex(bytes)
export const fromHex = (hex: Hex): Uint8Array => hexToBytes(hex)
