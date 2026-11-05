import { describe, expect, test } from 'bun:test'
import type { Hex } from 'viem'
import { newOwnershipKeypair, proveOwnership, verifyOwnership } from './zkOwnership'

describe('ownership proof (Schnorr, secp256k1)', () => {
  test('verifies for the right secret and context', () => {
    const kp = newOwnershipKeypair()
    const proof = proveOwnership(kp.secret, 'ctx-1')
    expect(verifyOwnership(kp.commitment, proof, 'ctx-1')).toBe(true)
  })

  test('is bound to its context (no replay under another challenge)', () => {
    const kp = newOwnershipKeypair()
    const proof = proveOwnership(kp.secret, 'ctx-1')
    expect(verifyOwnership(kp.commitment, proof, 'ctx-2')).toBe(false)
  })

  test('fails for a different commitment', () => {
    const a = newOwnershipKeypair()
    const b = newOwnershipKeypair()
    expect(verifyOwnership(b.commitment, proveOwnership(a.secret, 'c'), 'c')).toBe(false)
  })

  test('rejects tampered or malformed proofs without throwing', () => {
    const kp = newOwnershipKeypair()
    const proof = proveOwnership(kp.secret, 'c')
    const z = (proof.z.slice(0, -1) + (proof.z.endsWith('0') ? '1' : '0')) as Hex
    expect(verifyOwnership(kp.commitment, { ...proof, z }, 'c')).toBe(false)
    expect(verifyOwnership(kp.commitment, { R: '0x00', z: proof.z }, 'c')).toBe(false)
    expect(verifyOwnership('0x1234', proof, 'c')).toBe(false)
    expect(verifyOwnership(kp.commitment, { R: proof.R, z: ('0x' + '00'.repeat(32)) as Hex }, 'c')).toBe(false)
  })

  test('proofs are randomized and do not reveal the secret', () => {
    const kp = newOwnershipKeypair()
    const p1 = proveOwnership(kp.secret, 'c')
    const p2 = proveOwnership(kp.secret, 'c')
    expect(p1.R).not.toBe(p2.R)
    expect(JSON.stringify(p1)).not.toContain(kp.secret.slice(2))
  })

  test('a valid proof says nothing about voucher validity: any random secret verifies', () => {
    const fake = newOwnershipKeypair() // commitment to a secret that guards no voucher at all
    expect(verifyOwnership(fake.commitment, proveOwnership(fake.secret, 'c'), 'c')).toBe(true)
  })
})
