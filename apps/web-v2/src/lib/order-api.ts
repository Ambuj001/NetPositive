import { api } from './account.ts'
import type { Order } from './data.ts'
export type ReqStatus =
  | 'pending_funding'
  | 'open'
  | 'accepted'
  | 'code_submitted'
  | 'disputed'
  | 'releasing'
  | 'released'
  | 'refunding'
  | 'refunded'
  | 'cancelled'
export type ApiRequest = {
  id: string
  requester: string
  fulfiller: string | null
  brand: string
  amountInr: number
  amountUsdc: string
  status: ReqStatus
  escrowId: string
  escrowTxHash: string | null
  releaseTxHash: string | null
  refundTxHash: string | null
  fulfilDeadline: string | null
  reviewDeadline: string | null
  createdAt: string | null
  disputeReason?: string | null
}
export const STATUS: Record<ReqStatus, string> = {
  pending_funding: 'Awaiting deposit',
  open: 'Open',
  accepted: 'Accepted',
  code_submitted: 'Voucher submitted',
  disputed: 'In dispute',
  releasing: 'Releasing',
  released: 'Completed',
  refunding: 'Refunding',
  refunded: 'Refunded',
  cancelled: 'Cancelled',
}
export const brandIdFromApi = (name: string) =>
  ({ makemytrip: 'mmt' })[name] ?? name
export function toOrder(r: ApiRequest): Order {
  const usdc = Number(r.amountUsdc)
  if (
    !Number.isFinite(usdc) ||
    usdc <= 0 ||
    !Number.isFinite(r.amountInr) ||
    r.amountInr <= 0
  )
    throw new Error('Invalid order amounts from account service.')
  return {
    id: r.id,
    brandId: brandIdFromApi(r.brand),
    brandName: r.brand,
    amount: r.amountInr,
    rate: r.amountInr / usdc,
    seller: r.requester,
    sellerTrades: 0,
    city: '',
    postedMin: r.createdAt
      ? Math.max(0, Math.floor((Date.now() - Date.parse(r.createdAt)) / 60000))
      : 0,
    expiresMin: 30,
    source: 'live',
  }
}
export const orderApi = {
  listOpen: () => api<{ requests: ApiRequest[] }>('/requests?limit=50'),
  mine: (token: string) =>
    api<{ asRequester: ApiRequest[]; asFulfiller: ApiRequest[] }>(
      '/requests/mine',
      token,
    ),
  get: (id: string) =>
    api<{ request: ApiRequest }>(`/requests/${encodeURIComponent(id)}`),
  create: (
    token: string,
    brand: string,
    amountInr: number,
    amountUsdc: string,
  ) =>
    api<{ request: ApiRequest; escrowContract: string | null }>(
      '/requests',
      token,
      { brand, amountInr, amountUsdc },
    ),
  fund: (id: string, token: string, txHash: string) =>
    api<{ request: ApiRequest }>(
      `/requests/${encodeURIComponent(id)}/fund`,
      token,
      { txHash },
    ),
  accept: (id: string, token: string) =>
    api<{ request: ApiRequest }>(
      `/requests/${encodeURIComponent(id)}/accept`,
      token,
      {},
    ),
  cancel: (id: string, token: string) =>
    api<{ request: ApiRequest }>(
      `/requests/${encodeURIComponent(id)}/cancel`,
      token,
      {},
    ),
  submit: (id: string, token: string, code: string, pin: string) =>
    api<{ request: ApiRequest }>(
      `/requests/${encodeURIComponent(id)}/submit-code`,
      token,
      { code, pin },
    ),
  voucher: (id: string, token: string) =>
    api<{ voucher: { code: string; pin?: string | null } }>(
      `/requests/${encodeURIComponent(id)}/voucher`,
      token,
    ),
  confirm: (id: string, token: string) =>
    api<{ request: ApiRequest }>(
      `/requests/${encodeURIComponent(id)}/confirm`,
      token,
      {},
    ),
}
