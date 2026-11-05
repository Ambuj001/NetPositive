import { describe, expect, test } from 'bun:test'
import { hashTypedData, type Address, type Hex } from 'viem'
import { envelopeDigest, parseEnvelope } from './envelope'
import { attestationTypedData } from './attestation'

const good = {
  v: 1,
  tradeId: `0x${'11'.repeat(32)}`,
  recipientKeyHash: `0x${'22'.repeat(32)}`,
  ephemeralPub: `0x04${'33'.repeat(64)}`,
  iv: `0x${'44'.repeat(12)}`,
  ciphertext: `0x${'55'.repeat(40)}`,
}

describe('envelope schema', () => {
  test('accepts a well-formed envelope', () => {
    expect(parseEnvelope(good).v).toBe(1)
  })
  test('rejects wrong sizes, versions and unknown keys', () => {
    expect(() => parseEnvelope({ ...good, v: 2 })).toThrow()
    expect(() => parseEnvelope({ ...good, iv: '0x00' })).toThrow()
    expect(() => parseEnvelope({ ...good, ciphertext: `0x${'55'.repeat(10)}` })).toThrow()
    expect(() => parseEnvelope({ ...good, extra: 1 })).toThrow()
    expect(() => parseEnvelope(null)).toThrow()
  })
  test('digest commits to every field', () => {
    const base = envelopeDigest(parseEnvelope(good))
    for (const [k, v] of Object.entries({
      tradeId: `0x${'12'.repeat(32)}`,
      recipientKeyHash: `0x${'23'.repeat(32)}`,
      ephemeralPub: `0x04${'34'.repeat(64)}`,
      iv: `0x${'45'.repeat(12)}`,
      ciphertext: `0x${'56'.repeat(40)}`,
    })) {
      expect(envelopeDigest(parseEnvelope({ ...good, [k]: v }))).not.toBe(base)
    }
  })
})

/**
 * Cross-language parity: the Solidity test `NetPositive.TsParity.t.sol` asserts the contract produces this
 * exact EIP-712 digest for the same inputs, so the backend signer and the contract cannot drift apart.
 */
export const PARITY = {
  chainId: 5042002,
  contract: '0x00000000000000000000000000000000000beef1' as Address,
  tradeId: `0x${'aa'.repeat(32)}` as Hex,
  deliveryDigest: `0x${'bb'.repeat(32)}` as Hex,
  buyerRecipient: `0x${'cc'.repeat(32)}` as Hex,
  expiry: 1_900_000_000n,
}

describe('attestation typed data', () => {
  test('matches the digest pinned in the Solidity parity test', () => {
    const digest = hashTypedData(
      attestationTypedData(PARITY.chainId, PARITY.contract, {
        tradeId: PARITY.tradeId,
        deliveryDigest: PARITY.deliveryDigest,
        buyerRecipient: PARITY.buyerRecipient,
        expiry: PARITY.expiry,
      }),
    )
    expect(digest).toBe('0xb3493bf794e4d5b764cc93e080a27dab3436c85037e1e2a83089b184f92d1f5a')
  })
})
