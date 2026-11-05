import { describe, expect, test } from 'bun:test'
import { keccak256, type Hex } from 'viem'
import {
  decryptDelivery,
  decryptWithPassphrase,
  encryptDelivery,
  encryptWithPassphrase,
  generateRecipientKey,
  randomHex32,
} from './crypto'
import { envelopeDigest, parseEnvelope } from '@/shared/envelope'
import { buildRecoveryExport, emptyVault, newRecord, parsePayload, readRecoveryExport, syntheticExample, toPayload } from './vault'

// Low iteration count keeps unit tests fast; production uses 600,000.
const FAST = 100_000

describe('passphrase encryption (AES-256-GCM)', () => {
  test('round-trips and uses fresh salt and iv each time', async () => {
    const a = await encryptWithPassphrase('synthetic secret', 'correct horse battery', 'vault', FAST)
    const b = await encryptWithPassphrase('synthetic secret', 'correct horse battery', 'vault', FAST)
    expect(a.ciphertext).not.toBe(b.ciphertext)
    expect(a.kdf.salt).not.toBe(b.kdf.salt)
    expect(await decryptWithPassphrase(a, 'correct horse battery')).toBe('synthetic secret')
  })

  test('rejects a wrong passphrase and tampered ciphertext', async () => {
    const blob = await encryptWithPassphrase('x', 'correct horse battery', 'vault', FAST)
    await expect(decryptWithPassphrase(blob, 'wrong passphrase!!')).rejects.toThrow()
    const raw = atob(blob.ciphertext)
    const flipped = String.fromCharCode(raw.charCodeAt(0) ^ 1) + raw.slice(1)
    await expect(decryptWithPassphrase({ ...blob, ciphertext: btoa(flipped) }, 'correct horse battery')).rejects.toThrow()
  })

  test('a vault blob cannot be opened as a recovery blob (kind is authenticated)', async () => {
    const blob = await encryptWithPassphrase('x', 'correct horse battery', 'vault', FAST)
    await expect(decryptWithPassphrase({ ...blob, kind: 'recovery' }, 'correct horse battery')).rejects.toThrow()
  })

  test('refuses unsafe KDF parameters from an untrusted file', async () => {
    const blob = await encryptWithPassphrase('x', 'correct horse battery', 'vault', FAST)
    await expect(decryptWithPassphrase({ ...blob, kdf: { ...blob.kdf, iterations: 1 } }, 'correct horse battery')).rejects.toThrow()
  })

  test('ciphertext does not contain the plaintext', async () => {
    const blob = await encryptWithPassphrase('SYNTH-0000-0000-0000', 'correct horse battery', 'vault', FAST)
    expect(JSON.stringify(blob)).not.toContain('SYNTH')
  })
})

describe('delivery envelopes', () => {
  const tradeId: Hex = randomHex32()
  const payload = JSON.stringify(toPayload({ ...syntheticExample() }))

  test('buyer decrypts what the fulfiller encrypted; digest is stable', async () => {
    const key = await generateRecipientKey()
    expect(key.keyHash).toBe(keccak256(key.publicKey))
    const env = await encryptDelivery(payload, tradeId, key.publicKey)
    expect(parseEnvelope(env)).toEqual(env)
    expect(envelopeDigest(env)).toBe(envelopeDigest(env))
    const out = parsePayload(await decryptDelivery(env, key))
    expect(out.code).toBe('SYNTH-0000-0000-0000')
  })

  test('envelope contains no plaintext and is addressed to the committed key hash', async () => {
    const key = await generateRecipientKey()
    const env = await encryptDelivery(payload, tradeId, key.publicKey)
    expect(JSON.stringify(env)).not.toContain('SYNTH')
    expect(env.recipientKeyHash).toBe(key.keyHash)
  })

  test('a different recipient cannot decrypt', async () => {
    const buyer = await generateRecipientKey()
    const other = await generateRecipientKey()
    const env = await encryptDelivery(payload, tradeId, buyer.publicKey)
    await expect(decryptDelivery(env, other)).rejects.toThrow()
  })

  test('ciphertext is bound to its trade id (replay into another order fails)', async () => {
    const key = await generateRecipientKey()
    const env = await encryptDelivery(payload, tradeId, key.publicKey)
    await expect(decryptDelivery({ ...env, tradeId: randomHex32() }, key)).rejects.toThrow()
  })

  test('tampering changes the digest and fails authentication', async () => {
    const key = await generateRecipientKey()
    const env = await encryptDelivery(payload, tradeId, key.publicKey)
    const last = env.ciphertext.slice(-2) === '00' ? '01' : '00'
    const bad = { ...env, ciphertext: (env.ciphertext.slice(0, -2) + last) as Hex }
    expect(envelopeDigest(bad)).not.toBe(envelopeDigest(env))
    await expect(decryptDelivery(bad, key)).rejects.toThrow()
  })
})

describe('encrypted recovery export', () => {
  test('restores records and recipient keys, and contains no plaintext', async () => {
    const vault = emptyVault()
    const rec = newRecord({ ...syntheticExample() })
    vault.records.push(rec)
    const exported = JSON.stringify(await buildRecoveryExport(vault, 'recovery passphrase 1'))
    expect(exported).not.toContain('SYNTH')
    expect(exported).not.toContain(rec.ownershipSecret)
    const back = await readRecoveryExport(exported, 'recovery passphrase 1')
    expect(back.records[0]?.code).toBe('SYNTH-0000-0000-0000')
    await expect(readRecoveryExport(exported, 'not the passphrase')).rejects.toThrow()
  })
})
