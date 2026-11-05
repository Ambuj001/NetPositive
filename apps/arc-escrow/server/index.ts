/**
 * NetPositive backend. Start with `bun run server` (port 3001, proxied by Vite at /api).
 * Roles: (1) opaque store for client-encrypted delivery envelopes and buyer public keys,
 *        (2) validator that signs EIP-712 delivery attestations after checking onchain state,
 *        (3) verifier for ownership proofs.
 * It never receives voucher plaintext, card data, passphrases, or user keys.
 */
import { createPublicClient, defineChain, http, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { netPositiveAbi } from '../src/abi/netPositiveAbi'
import { getUsdc, requireChain } from '../src/onchain-facts'
import { createApp, isConfiguredAddress, MAX_BODY_BYTES, type ChainOrder, type Signer } from './app'
import { Store } from './store'

const ARC_TESTNET_ID = 5042002
const chainFacts = requireChain(ARC_TESTNET_ID)
const usdc = getUsdc(ARC_TESTNET_ID)
if (!usdc) throw new Error('USDC is not registered for Arc Testnet')

// RPC: prefer a per-chain override, then the Arc Studio proxy, then the public endpoint from the chain registry.
const COMPASS_CHAIN = 'Arc_Testnet'
const proxyChains = (process.env.RPC_PROXY_CHAINS || '').split(',')
const rpcUrl =
  process.env[`RPC_URL_${COMPASS_CHAIN}`] ||
  (process.env.RPC_PROXY_BASE_URL && process.env.RPC_PROXY_TOKEN && proxyChains.includes(COMPASS_CHAIN)
    ? `${process.env.RPC_PROXY_BASE_URL}/api/rpc/${COMPASS_CHAIN}?_rpc_token=${process.env.RPC_PROXY_TOKEN}`
    : chainFacts.rpcUrls[0])

const chain = defineChain({
  id: ARC_TESTNET_ID,
  name: chainFacts.name,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: chainFacts.nativeCurrency.decimals },
  rpcUrls: { default: { http: [rpcUrl] } },
})
const client = createPublicClient({ chain, transport: http(rpcUrl) })

const contractEnv = process.env.VITE_NETPOSITIVE_ADDRESS
const contract: Address | undefined = isConfiguredAddress(contractEnv) ? contractEnv : undefined

const validatorKey = process.env.NP_VALIDATOR_PRIVATE_KEY
const account = validatorKey && /^0x[0-9a-fA-F]{64}$/.test(validatorKey) ? privateKeyToAccount(validatorKey as Hex) : undefined
const signer: Signer | undefined = account
  ? { address: account.address, signTypedData: (args) => account.signTypedData(args) }
  : undefined

const validatorEnv = process.env.VITE_NETPOSITIVE_VALIDATOR
const validator: Address = account?.address ?? (isConfiguredAddress(validatorEnv) ? validatorEnv : '0x0000000000000000000000000000000000000000')

const readOrder = contract
  ? async (tradeId: Hex): Promise<ChainOrder> => {
      const o = await client.readContract({ address: contract, abi: netPositiveAbi, functionName: 'getOrder', args: [tradeId] })
      return { state: o.state, deliveryDeadline: Number(o.deliveryDeadline), buyerRecipient: o.buyerRecipient }
    }
  : undefined

const app = createApp({
  store: new Store(new URL('./data/store.json', import.meta.url).pathname),
  chainId: ARC_TESTNET_ID,
  usdc: usdc.address as Address,
  contract,
  signer,
  validator,
  readOrder,
})

const port = Number(process.env.PORT ?? 3001)
Bun.serve({ hostname: process.env.HOST ?? '127.0.0.1', port, maxRequestBodySize: MAX_BODY_BYTES, fetch: app })
console.log(
  `NetPositive backend on :${port} | contract ${contract ?? 'NOT SET'} | validator ${validator} | signer ${signer ? 'ready' : 'missing'}`,
)
