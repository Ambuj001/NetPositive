import { describe, expect, test } from 'bun:test'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { hashTypedData, keccak256, recoverTypedDataAddress, type Address, type Hex } from 'viem'
import { createApp, MAX_BODY_BYTES, type ChainOrder } from './app'
import { Store } from './store'
import { attestationTypedData } from '../src/shared/attestation'
import { envelopeDigest } from '../src/shared/envelope'
import { encryptDelivery, generateRecipientKey, randomHex32 } from '../src/lib/crypto'
import { newOwnershipKeypair, proveOwnership } from '../src/lib/zkOwnership'

const CONTRACT: Address = '0x00000000000000000000000000000000000beef1'
const CHAIN_ID = 5042002
const USDC: Address = '0x3600000000000000000000000000000000000000'

async function setup(orderOverrides: Partial<ChainOrder> = {}) {
  const validatorAccount = privateKeyToAccount(generatePrivateKey())
  const buyerKey = await generateRecipientKey()
  const tradeId = randomHex32()
  let clock = 1_800_000_000_000
  const order: ChainOrder = {
    state: 1,
    deliveryDeadline: Math.floor(clock / 1000) + 3600,
    buyerRecipient: buyerKey.keyHash,
    ...orderOverrides,
  }
  const app = createApp({
    store: new Store(),
    chainId: CHAIN_ID,
    usdc: USDC,
    contract: CONTRACT,
    validator: validatorAccount.address,
    signer: { address: validatorAccount.address, signTypedData: (a) => validatorAccount.signTypedData(a) },
    readOrder: () => Promise.resolve(order),
    now: () => clock,
  })
  const post = (path: string, body: unknown) =>
    app(new Request(`http://x${path}`, { method: 'POST', body: JSON.stringify(body) }))
  const get = (path: string) => app(new Request(`http://x${path}`))
  return { app, post, get, validatorAccount, buyerKey, tradeId, order, tick: (ms: number) => (clock += ms) }
}

describe('validator attestation', () => {
  test('signs an EIP-712 attestation bound to trade, digest, recipient, expiry, chain and contract', async () => {
    const t = await setup()
    const env = await encryptDelivery('{"schema":"np-voucher/1","code":"SYNTH"}', t.tradeId, t.buyerKey.publicKey)
    const up = await t.post('/api/envelopes', env)
    expect(up.status).toBe(201)
    const { digest } = (await up.json()) as { digest: Hex }
    expect(digest).toBe(envelopeDigest(env))

    const res = await t.post('/attest', { tradeId: t.tradeId, deliveryDigest: digest })
    expect(res.status).toBe(200)
    const out = (await res.json()) as { expiry: string; signature: Hex; buyerRecipient: Hex }
    expect(out.buyerRecipient).toBe(t.buyerKey.keyHash)

    const typed = attestationTypedData(CHAIN_ID, CONTRACT, {
      tradeId: t.tradeId,
      deliveryDigest: digest,
      buyerRecipient: t.buyerKey.keyHash,
      expiry: BigInt(out.expiry),
    })
    expect(await recoverTypedDataAddress({ ...typed, signature: out.signature })).toBe(t.validatorAccount.address)

    // A different chain or contract produces a different signing hash, so the signature cannot be replayed.
    const otherChain = attestationTypedData(1, CONTRACT, typed.message)
    const otherContract = attestationTypedData(CHAIN_ID, '0x00000000000000000000000000000000000beef2', typed.message)
    expect(hashTypedData(otherChain)).not.toBe(hashTypedData(typed))
    expect(hashTypedData(otherContract)).not.toBe(hashTypedData(typed))
  })

  test('refuses when the order is not open, past deadline, or the envelope is for another recipient', async () => {
    const closed = await setup({ state: 2 })
    const env = await encryptDelivery('x', closed.tradeId, closed.buyerKey.publicKey)
    const { digest } = (await (await closed.post('/envelopes', env)).json()) as { digest: Hex }
    expect((await closed.post('/attest', { tradeId: closed.tradeId, deliveryDigest: digest })).status).toBe(409)

    const late = await setup()
    const env2 = await encryptDelivery('x', late.tradeId, late.buyerKey.publicKey)
    const { digest: d2 } = (await (await late.post('/envelopes', env2)).json()) as { digest: Hex }
    late.tick(2 * 3600 * 1000)
    expect((await late.post('/attest', { tradeId: late.tradeId, deliveryDigest: d2 })).status).toBe(409)

    const wrong = await setup()
    const stranger = await generateRecipientKey()
    const env3 = await encryptDelivery('x', wrong.tradeId, stranger.publicKey)
    const { digest: d3 } = (await (await wrong.post('/envelopes', env3)).json()) as { digest: Hex }
    expect((await wrong.post('/attest', { tradeId: wrong.tradeId, deliveryDigest: d3 })).status).toBe(409)
  })

  test('refuses an unknown envelope or a trade id that does not match the envelope', async () => {
    const t = await setup()
    expect((await t.post('/attest', { tradeId: t.tradeId, deliveryDigest: randomHex32() })).status).toBe(404)
    const env = await encryptDelivery('x', t.tradeId, t.buyerKey.publicKey)
    const { digest } = (await (await t.post('/envelopes', env)).json()) as { digest: Hex }
    expect((await t.post('/attest', { tradeId: randomHex32(), deliveryDigest: digest })).status).toBe(400)
  })
})

describe('plaintext never accepted', () => {
  test('envelope upload rejects extra fields such as pan, cvv, pin, otp or plaintext', async () => {
    const t = await setup()
    const env = await encryptDelivery('x', t.tradeId, t.buyerKey.publicKey)
    for (const field of ['pan', 'cvv', 'pin', 'otp', 'code', 'plaintext', 'privateKey']) {
      const res = await t.post('/envelopes', { ...env, [field]: 'SYNTH-0000' })
      expect(res.status).toBe(400)
    }
  })

  test('rejects malformed, tiny, and oversized payloads', async () => {
    const t = await setup()
    const env = await encryptDelivery('x', t.tradeId, t.buyerKey.publicKey)
    expect((await t.post('/envelopes', { ...env, ciphertext: '0x00' })).status).toBe(400)
    expect((await t.post('/envelopes', { ...env, iv: '0x12' })).status).toBe(400)
    expect((await t.post('/envelopes', 'a plain string')).status).toBe(400)
    const huge = await t.app(new Request('http://x/envelopes', { method: 'POST', body: 'x'.repeat(MAX_BODY_BYTES + 1) }))
    expect(huge.status).toBe(413)
  })
})

describe('recipient key publication', () => {
  test('accepts only the key that matches the onchain commitment', async () => {
    const t = await setup()
    expect((await t.post('/recipients', { tradeId: t.tradeId, publicKey: t.buyerKey.publicKey })).status).toBe(201)
    expect(keccak256(t.buyerKey.publicKey)).toBe(t.buyerKey.keyHash)
    const got = (await (await t.get(`/recipients/${t.tradeId}`)).json()) as { publicKey: Hex }
    expect(got.publicKey).toBe(t.buyerKey.publicKey)

    const attacker = await generateRecipientKey()
    expect((await t.post('/recipients', { tradeId: randomHex32(), publicKey: attacker.publicKey })).status).toBe(400)
  })
})

describe('ownership proof endpoint', () => {
  test('verifies a proof once per challenge and labels what it does not prove', async () => {
    const t = await setup()
    const ch = (await (await t.get('/ownership/challenge')).json()) as { nonce: string; context: string }
    const kp = newOwnershipKeypair()
    const proof = proveOwnership(kp.secret, ch.context)
    const ok = await t.post('/ownership/verify', { commitment: kp.commitment, proof, nonce: ch.nonce })
    const body = (await ok.json()) as { valid: boolean; note: string }
    expect(body.valid).toBe(true)
    expect(body.note).toContain('nothing about whether any voucher is valid')
    const replay = await t.post('/ownership/verify', { commitment: kp.commitment, proof, nonce: ch.nonce })
    expect(replay.status).toBe(400)
  })
})
