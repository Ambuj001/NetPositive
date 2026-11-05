/**
 * Arbitrator CLI (testnet demo). Rules on a disputed order using NP_ARBITRATOR_PRIVATE_KEY.
 *   bun run arbitrate <tradeId> fulfiller   # pay the fulfiller
 *   bun run arbitrate <tradeId> buyer       # refund the buyer
 * The arbitrator can only choose between these two outcomes and only before the dispute deadline.
 */
import { createPublicClient, createWalletClient, defineChain, http, isHex, type Address, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { netPositiveAbi } from '../src/abi/netPositiveAbi'
import { requireChain } from '../src/onchain-facts'

const [tradeId, outcome] = process.argv.slice(2)
if (!tradeId || !isHex(tradeId, { strict: true }) || tradeId.length !== 66 || (outcome !== 'fulfiller' && outcome !== 'buyer')) {
  console.error('Usage: bun run arbitrate <tradeId 0x..32 bytes> <fulfiller|buyer>')
  process.exit(1)
}
const contract = process.env.VITE_NETPOSITIVE_ADDRESS as Address | undefined
const key = process.env.NP_ARBITRATOR_PRIVATE_KEY as Hex | undefined
if (!contract || !key) {
  console.error('Set VITE_NETPOSITIVE_ADDRESS and NP_ARBITRATOR_PRIVATE_KEY in .env')
  process.exit(1)
}

const facts = requireChain(5042002)
const rpc = process.env.RPC_URL_Arc_Testnet || facts.rpcUrls[0]
const chain = defineChain({
  id: facts.chainId,
  name: facts.name,
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: facts.nativeCurrency.decimals },
  rpcUrls: { default: { http: [rpc] } },
})
const account = privateKeyToAccount(key)
const publicClient = createPublicClient({ chain, transport: http(rpc) })
const wallet = createWalletClient({ account, chain, transport: http(rpc) })

const hash = await wallet.writeContract({
  address: contract,
  abi: netPositiveAbi,
  functionName: 'resolveDispute',
  args: [tradeId, outcome === 'fulfiller'],
})
const receipt = await publicClient.waitForTransactionReceipt({ hash })
console.log(`resolveDispute(${outcome}) ${receipt.status} in tx ${hash}`)
