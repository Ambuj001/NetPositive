/**
 * Local end-to-end check on a throwaway anvil chain (chain id 5042002, synthetic mock USDC, no real funds).
 *   forge build && bun run scripts/e2e-local.ts
 * Exercises the real contract with the real backend handlers and browser crypto: fund -> publish key ->
 * encrypt -> upload -> attest -> submit -> decrypt -> accept -> withdraw, plus forged-attestation and
 * 50/50 fallback paths.
 */
import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { createPublicClient, createWalletClient, defineChain, http, parseUnits, type Address, type Hex } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { netPositiveAbi } from '../src/abi/netPositiveAbi'
import { decryptDelivery, encryptDelivery, generateRecipientKey, randomHex32 } from '../src/lib/crypto'
import { computeTradeId } from '../src/lib/netpositive'
import { envelopeDigest } from '../src/shared/envelope'
import { createApp } from '../server/app'
import { Store } from '../server/store'

const PORT = 8546
const RPC = `http://127.0.0.1:${PORT}`
const USDC: Address = '0x3600000000000000000000000000000000000000'
const chain = defineChain({ id: 5042002, name: 'local-arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } })
const pub = createPublicClient({ chain, transport: http(RPC) })
const mockAbi = [
  { type: 'function', name: 'mint', inputs: [{ name: 'to', type: 'address' }, { name: 'amount', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'approve', inputs: [{ name: 's', type: 'address' }, { name: 'a', type: 'uint256' }], outputs: [{ type: 'bool' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'balanceOf', inputs: [{ name: 'a', type: 'address' }], outputs: [{ type: 'uint256' }], stateMutability: 'view' },
] as const

const rpc = (method: string, params: unknown[] = []) => pub.request({ method, params } as never)
const ok = (cond: boolean, label: string) => {
  if (!cond) throw new Error(`FAIL: ${label}`)
  console.log(`PASS  ${label}`)
}
const mkAccount = async () => {
  const account = privateKeyToAccount(generatePrivateKey())
  await rpc('anvil_setBalance', [account.address, '0x56BC75E2D63100000'])
  return { account, wallet: createWalletClient({ account, chain, transport: http(RPC) }) }
}

const anvil = spawn('anvil', ['--chain-id', '5042002', '--port', String(PORT), '--silent'], { stdio: 'ignore' })
try {
  for (let i = 0; i < 50; i++) {
    try {
      await pub.getChainId()
      break
    } catch {
      await new Promise((r) => setTimeout(r, 200))
    }
  }
  const mock = JSON.parse(readFileSync('contracts/out/NetPositive.t.sol/MockUSDC.json', 'utf8')) as { deployedBytecode: { object: Hex } }
  await rpc('anvil_setCode', [USDC, mock.deployedBytecode.object])
  const np = JSON.parse(readFileSync('contracts/out/NetPositive.sol/NetPositive.json', 'utf8')) as { bytecode: { object: Hex } }

  const [validator, arbitrator, treasury, buyer, fulfiller] = await Promise.all([mkAccount(), mkAccount(), mkAccount(), mkAccount(), mkAccount()])
  const deployHash = await buyer.wallet.deployContract({
    abi: netPositiveAbi,
    bytecode: np.bytecode.object,
    args: [validator.account.address, arbitrator.account.address, treasury.account.address, 3600n, 86_400n],
  })
  const contract = (await pub.waitForTransactionReceipt({ hash: deployHash })).contractAddress as Address
  ok(Boolean(contract), 'contract deploys on chain id 5042002 with USDC validation passing')

  const app = createApp({
    store: new Store(),
    chainId: 5042002,
    usdc: USDC,
    contract,
    validator: validator.account.address,
    signer: { address: validator.account.address, signTypedData: (a) => validator.account.signTypedData(a) },
    readOrder: async (id) => {
      const o = await pub.readContract({ address: contract, abi: netPositiveAbi, functionName: 'getOrder', args: [id] })
      return { state: o.state, deliveryDeadline: Number(o.deliveryDeadline), buyerRecipient: o.buyerRecipient }
    },
  })
  const post = async <T>(path: string, body: unknown): Promise<{ status: number; body: T }> => {
    const r = await app(new Request(`http://x${path}`, { method: 'POST', body: JSON.stringify(body) }))
    return { status: r.status, body: (await r.json()) as T }
  }
  const tx = async (hash: Hex) => (await pub.waitForTransactionReceipt({ hash })).status
  const now = async () => Number((await pub.getBlock()).timestamp)
  const bal = (a: Address) => pub.readContract({ address: USDC, abi: mockAbi, functionName: 'balanceOf', args: [a] })

  await tx(await buyer.wallet.writeContract({ address: USDC, abi: mockAbi, functionName: 'mint', args: [buyer.account.address, parseUnits('1000', 6)] }))
  await tx(await buyer.wallet.writeContract({ address: USDC, abi: mockAbi, functionName: 'approve', args: [contract, parseUnits('1000', 6)] }))

  const newOrder = async (principal: string) => {
    const key = await generateRecipientKey()
    const salt = randomHex32()
    const tradeId = computeTradeId(contract, buyer.account.address, salt)
    const deadline = BigInt((await now()) + 3600)
    await tx(await buyer.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'createOrder', args: [salt, fulfiller.account.address, parseUnits(principal, 6), deadline, key.keyHash] }))
    return { key, tradeId }
  }

  // --- Order 1: full happy path -------------------------------------------------
  const o1 = await newOrder('25')
  ok((await bal(contract)) === parseUnits('25.25', 6), 'escrow holds principal + 1% fee (25.25 USDC)')
  const bad = await post<{ error: string }>('/recipients', { tradeId: o1.tradeId, publicKey: (await generateRecipientKey()).publicKey })
  ok(bad.status === 400, 'backend rejects a swapped recipient key (onchain commitment wins)')
  ok((await post('/recipients', { tradeId: o1.tradeId, publicKey: o1.key.publicKey })).status === 201, 'buyer publishes the committed public key')

  const secret = JSON.stringify({ schema: 'np-voucher/1', merchant: 'Synthetic Coffee Co (demo)', faceValue: '25.00', code: 'SYNTH-0000-0000-0000', pin: '0000', notes: '' })
  const env = await encryptDelivery(secret, o1.tradeId, o1.key.publicKey)
  const digest = envelopeDigest(env)
  ok((await post('/envelopes', env)).status === 201, 'ciphertext uploaded (no plaintext)')
  const att = await post<{ expiry: string; signature: Hex }>('/attest', { tradeId: o1.tradeId, deliveryDigest: digest })
  ok(att.status === 200, 'validator signs attestation after reading onchain state')

  const forged = await fulfiller.account.signTypedData({
    domain: { name: 'NetPositive', version: '1', chainId: 5042002, verifyingContract: contract },
    types: { DeliveryAttestation: [{ name: 'tradeId', type: 'bytes32' }, { name: 'deliveryDigest', type: 'bytes32' }, { name: 'buyerRecipient', type: 'bytes32' }, { name: 'expiry', type: 'uint64' }] },
    primaryType: 'DeliveryAttestation',
    message: { tradeId: o1.tradeId, deliveryDigest: digest, buyerRecipient: o1.key.keyHash, expiry: BigInt(att.body.expiry) },
  })
  let forgedRejected = false
  try {
    await fulfiller.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'submitDelivery', args: [o1.tradeId, digest, BigInt(att.body.expiry), forged] })
  } catch {
    forgedRejected = true
  }
  ok(forgedRejected, 'contract rejects an attestation signed by anyone but the validator')

  ok((await tx(await fulfiller.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'submitDelivery', args: [o1.tradeId, digest, BigInt(att.body.expiry), att.body.signature] }))) === 'success', 'contract accepts the backend EIP-712 signature')
  const stored = await app(new Request(`http://x/envelopes/${digest}`))
  const fetched = (await stored.json()) as typeof env
  ok(envelopeDigest(fetched) === digest, 'ciphertext matches the onchain digest')
  ok((JSON.parse(await decryptDelivery(fetched, o1.key)) as { code: string }).code === 'SYNTH-0000-0000-0000', 'buyer decrypts locally')
  await tx(await buyer.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'acceptDelivery', args: [o1.tradeId] }))
  await tx(await fulfiller.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'withdraw', args: [fulfiller.account.address] }))
  await tx(await treasury.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'withdraw', args: [treasury.account.address] }))
  ok((await bal(fulfiller.account.address)) === parseUnits('25', 6), 'fulfiller withdraws the full principal')
  ok((await bal(treasury.account.address)) === 175_000n, 'revenue is 70% of the 0.25 USDC fee')
  ok((await pub.readContract({ address: contract, abi: netPositiveAbi, functionName: 'disputeReserve' })) === 75_000n, 'dispute reserve is 30% of the fee')

  // --- Order 2: dispute, arbitrator silent, 50/50 fallback ---------------------------
  const o2 = await newOrder('10')
  await post('/recipients', { tradeId: o2.tradeId, publicKey: o2.key.publicKey })
  const env2 = await encryptDelivery(secret, o2.tradeId, o2.key.publicKey)
  const d2 = envelopeDigest(env2)
  await post('/envelopes', env2)
  const a2 = await post<{ expiry: string; signature: Hex }>('/attest', { tradeId: o2.tradeId, deliveryDigest: d2 })
  await tx(await fulfiller.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'submitDelivery', args: [o2.tradeId, d2, BigInt(a2.body.expiry), a2.body.signature] }))
  await tx(await buyer.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'openDispute', args: [o2.tradeId] }))
  let earlyRejected = false
  try {
    await fulfiller.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'finalizeUnresolvedDispute', args: [o2.tradeId] })
  } catch {
    earlyRejected = true
  }
  ok(earlyRejected, 'fallback cannot run before the arbitration deadline')
  await rpc('evm_increaseTime', [86_401])
  await rpc('evm_mine')
  await tx(await fulfiller.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'finalizeUnresolvedDispute', args: [o2.tradeId] }))
  const before = await bal(buyer.account.address)
  await tx(await buyer.wallet.writeContract({ address: contract, abi: netPositiveAbi, functionName: 'withdraw', args: [buyer.account.address] }))
  ok((await bal(buyer.account.address)) - before === parseUnits('5.10', 6), 'fallback: buyer gets half the principal plus the full fee back')
  const [balance, liabilities] = await pub.readContract({ address: contract, abi: netPositiveAbi, functionName: 'solvency' })
  ok(balance >= liabilities, 'contract stays solvent')
  console.log('\nAll local end-to-end checks passed.')
} finally {
  anvil.kill()
}
