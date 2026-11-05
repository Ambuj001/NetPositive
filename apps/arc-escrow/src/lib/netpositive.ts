import { arcTestnet } from 'viem/chains'
import { encodeAbiParameters, isAddress, keccak256, type Address, type Hex } from 'viem'
import { getUsdc } from '@/onchain-facts'

export const CHAIN_ID = arcTestnet.id

const rawAddress = import.meta.env.VITE_NETPOSITIVE_ADDRESS as string | undefined
/** Set after deployment: VITE_NETPOSITIVE_ADDRESS in .env. Undefined means "not deployed yet". */
export const NP_ADDRESS: Address | undefined = rawAddress && isAddress(rawAddress) ? rawAddress : undefined

const rawBlock = import.meta.env.VITE_NETPOSITIVE_DEPLOY_BLOCK as string | undefined
/** Block the contract was deployed at. Order scans start here, never at genesis. */
export const DEPLOY_BLOCK: bigint | undefined = rawBlock && /^\d+$/.test(rawBlock) ? BigInt(rawBlock) : undefined

const usdcFact = getUsdc(CHAIN_ID)
if (!usdcFact) throw new Error('USDC is not registered for the target chain')
export const USDC_ADDRESS: Address = usdcFact.address as Address
export const USDC_DECIMALS_TARGET = usdcFact.decimals

export const FEE_BPS = 100n
export const BPS = 10_000n
export const RESERVE_SHARE_BPS = 3_000n
export const MIN_PRINCIPAL = 1_000_000n
export const MAX_PRINCIPAL = 10_000_000_000n

export const feeFor = (principal: bigint): bigint => (principal * FEE_BPS) / BPS

export enum OrderState {
  None = 0,
  Open = 1,
  Delivered = 2,
  Disputed = 3,
  Released = 4,
  Refunded = 5,
  ResolvedForBuyer = 6,
  ResolvedForFulfiller = 7,
  SplitFallback = 8,
}

export const STATE_LABEL: Record<OrderState, string> = {
  [OrderState.None]: 'Unknown',
  [OrderState.Open]: 'Awaiting delivery',
  [OrderState.Delivered]: 'In review',
  [OrderState.Disputed]: 'In dispute',
  [OrderState.Released]: 'Released',
  [OrderState.Refunded]: 'Refunded',
  [OrderState.ResolvedForBuyer]: 'Ruled for buyer',
  [OrderState.ResolvedForFulfiller]: 'Ruled for fulfiller',
  [OrderState.SplitFallback]: '50/50 fallback',
}

export const isTerminal = (s: OrderState): boolean => s >= OrderState.Released

export interface Order {
  tradeId: Hex
  buyer: Address
  state: OrderState
  deliveryDeadline: number
  fulfiller: Address
  reviewDeadline: number
  disputeDeadline: number
  principal: bigint
  fee: bigint
  buyerRecipient: Hex
  deliveryDigest: Hex
}

export interface RawOrder {
  buyer: Address
  state: number
  deliveryDeadline: bigint
  fulfiller: Address
  reviewDeadline: bigint
  disputeDeadline: bigint
  principal: bigint
  fee: bigint
  buyerRecipient: Hex
  deliveryDigest: Hex
}

export const toOrder = (tradeId: Hex, o: RawOrder): Order => ({
  tradeId,
  buyer: o.buyer,
  state: o.state,
  deliveryDeadline: Number(o.deliveryDeadline),
  fulfiller: o.fulfiller,
  reviewDeadline: Number(o.reviewDeadline),
  disputeDeadline: Number(o.disputeDeadline),
  principal: o.principal,
  fee: o.fee,
  buyerRecipient: o.buyerRecipient,
  deliveryDigest: o.deliveryDigest,
})

/** Mirrors NetPositive.computeTradeId so the key can be stored before the order tx is sent. */
export function computeTradeId(contract: Address, buyer: Address, salt: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'address' }, { type: 'address' }, { type: 'bytes32' }],
      [BigInt(CHAIN_ID), contract, buyer, salt],
    ),
  )
}

export const DELIVERY_WINDOWS = [
  { label: '1 hour', seconds: 3600 },
  { label: '6 hours', seconds: 6 * 3600 },
  { label: '24 hours', seconds: 24 * 3600 },
  { label: '3 days', seconds: 3 * 86400 },
] as const

export const shortHex = (v: string, head = 6, tail = 4): string =>
  v.length <= head + tail + 2 ? v : `${v.slice(0, head)}...${v.slice(-tail)}`

export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds))
  const d = Math.floor(s / 86400)
  const h = Math.floor((s % 86400) / 3600)
  const m = Math.floor((s % 3600) / 60)
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${m}m`
  return `${m}m ${s % 60}s`
}

const REVERT_HINTS: Record<string, string> = {
  InvalidParticipant: 'Buyer and fulfiller must be different accounts, and neither can be the validator or arbitrator.',
  InvalidPrincipal: 'Principal must be between 1 and 10,000 USDC.',
  InvalidDeliveryDeadline: 'Delivery window must be between 10 minutes and 7 days.',
  TradeAlreadyUsed: 'That trade ID already exists.',
  UnexpectedState: 'The order is not in the right state for this action.',
  Unauthorized: 'Your wallet is not allowed to do this on this order.',
  DeadlinePassed: 'The deadline for this step has passed.',
  DeadlineNotPassed: 'The deadline for this step has not passed yet.',
  AttestationExpired: 'The validator attestation expired. Request a new one.',
  InvalidAttestation: 'The validator attestation did not verify for this order.',
  IncorrectDeposit: 'USDC did not arrive in the exact amount.',
  NothingToWithdraw: 'Nothing to withdraw for this wallet.',
}

export function describeError(error: unknown): string {
  const text = error instanceof Error ? `${error.name} ${error.message}` : String(error)
  const lower = text.toLowerCase()
  if (lower.includes('user rejected') || lower.includes('user denied')) return 'Cancelled in wallet.'
  for (const [name, hint] of Object.entries(REVERT_HINTS)) if (text.includes(name)) return hint
  if (lower.includes('insufficient funds') || lower.includes('exceeds balance')) {
    return 'Insufficient balance. Get test USDC from the Arc Studio sidebar.'
  }
  if (lower.includes('network') || lower.includes('timeout')) return 'Network issue. Check your connection and retry.'
  const first = error instanceof Error ? (error.message.split('\n')[0] ?? '') : text
  return first.length > 160 ? `${first.slice(0, 157)}...` : first || 'Something went wrong.'
}
