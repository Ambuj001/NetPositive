import type { Order } from './data.ts'
import { quote, round2 } from './engine.ts'

export type TradeMode = 'buy' | 'sell'
export type OrderType = 'market' | 'limit'

export type BuyIntent = {
  id: string
  buyer: string
  brandId: string
  amount: number
  rate: number
}

// Separate, explicitly synthetic demand. These are not the seller's funded orders.
export const BUY_INTENTS: BuyIntent[] = [
  {
    id: 'BO-1042',
    buyer: 'meera.eth',
    brandId: 'lifestyle',
    amount: 10000,
    rate: 90,
  },
  {
    id: 'BO-1041',
    buyer: 'kabir.eth',
    brandId: 'amazon',
    amount: 5000,
    rate: 89.6,
  },
  {
    id: 'BO-1040',
    buyer: 'anya.eth',
    brandId: 'myntra',
    amount: 5000,
    rate: 90.4,
  },
  {
    id: 'BO-1039',
    buyer: 'ishaan.eth',
    brandId: 'croma',
    amount: 10000,
    rate: 89.2,
  },
]

export type BuyPreview = {
  fills: Order[]
  spend: number
  receive: number
  remainder: number
  averageRate: number
}

/** Whole voucher lots only. A preview never invents a partial fill or spends over budget.
 * A buy limit is a maximum INR/USDC price, before card rewards.
 * This is a bounded, deterministic UI preview, not a production matching engine.
 */
export function previewBuy(
  orders: Order[],
  budget: number,
  type: OrderType,
  limit: number,
  slippagePct = 8,
): BuyPreview {
  const empty = {
    fills: [],
    spend: 0,
    receive: 0,
    remainder: 0,
    averageRate: 0,
  }
  if (
    !Number.isFinite(budget) ||
    budget <= 0 ||
    (type === 'market' &&
      (!Number.isFinite(slippagePct) || slippagePct < 1 || slippagePct > 8)) ||
    (type === 'limit' && (!Number.isFinite(limit) || limit <= 0))
  )
    return empty
  const budgetPaise = Math.floor(budget * 100)
  const eligible = orders
    .filter(
      (o) =>
        Number.isFinite(o.amount) &&
        o.amount > 0 &&
        Number.isFinite(o.rate) &&
        o.rate > 0 &&
        o.expiresMin > 0 &&
        o.seller !== 'you' &&
        (type === 'market' || o.rate <= limit),
    )
    .sort(
      (a, b) =>
        a.rate - b.rate ||
        a.postedMin - b.postedMin ||
        a.id.localeCompare(b.id),
    )
  const bestMarketRate = eligible.find(
    (o) => Math.round(o.amount * 100) <= budgetPaise,
  )?.rate
  const withinSlippage =
    type === 'market' && bestMarketRate !== undefined
      ? eligible.filter(
          (o) => o.rate <= bestMarketRate * (1 + slippagePct / 100),
        )
      : eligible
  let remaining = budgetPaise
  let receive = 0
  const fills: Order[] = []
  for (const order of withinSlippage) {
    const paise = Math.round(order.amount * 100)
    if (paise > remaining) continue
    remaining -= paise
    receive = round2(receive + quote(order.amount, order.rate).buyerReceives)
    fills.push(order)
  }
  const spend = (budgetPaise - remaining) / 100
  return {
    fills,
    spend,
    receive,
    remainder: remaining / 100,
    averageRate: receive ? round2(spend / receive) : 0,
  }
}

/** A crypto seller receives vouchers. Their limit is a minimum INR/USDC rate. */
export function bestSellRate(
  intents: BuyIntent[],
  brandId: string,
  amount: number,
  type: OrderType,
  limit: number,
) {
  if (
    !Number.isFinite(amount) ||
    amount <= 0 ||
    (type === 'limit' && (!Number.isFinite(limit) || limit <= 0))
  )
    return null
  return (
    intents
      .filter(
        (o) =>
          o.brandId === brandId &&
          o.amount === amount &&
          o.rate > 0 &&
          Number.isFinite(o.rate) &&
          (type === 'market' || o.rate >= limit),
      )
      .sort((a, b) => b.rate - a.rate || a.id.localeCompare(b.id))[0] ?? null
  )
}

export type WorkspaceOrder = {
  id: string
  owner: string
  mode: TradeMode
  type: OrderType
  amount: number
  limit?: number
  slippagePct?: number
  brandId?: string
  brandName?: string
  matchedIds: string[]
  status: 'open' | 'cancelled'
}

export type ChatIntent = {
  amount?: number
  brandId?: string
  type?: OrderType
  question: 'orders' | 'fees' | 'cards' | 'help'
}

export function parseTradingMessage(
  text: string,
  brands: { id: string; name: string }[],
): ChatIntent {
  const value = text.trim().toLowerCase()
  const amountMatch =
    value.match(/(?:₹|inr\s*|rs\.?\s*)(\d[\d,]*(?:\.\d{1,2})?)(k)?/i) ??
    value.match(/(\d[\d,]*(?:\.\d{1,2})?)(k)?\s*(?:rupees|inr|rs)\b/i)
  const parsed = amountMatch
    ? Number(amountMatch[1].replaceAll(',', '')) * (amountMatch[2] ? 1000 : 1)
    : undefined
  return {
    amount:
      parsed && Number.isFinite(parsed) && parsed >= 100 && parsed <= 200000
        ? parsed
        : undefined,
    brandId: brands.find(
      (b) => value.includes(b.name.toLowerCase()) || value.includes(b.id),
    )?.id,
    type: /\blimit\b/.test(value)
      ? 'limit'
      : /\bmarket\b/.test(value)
        ? 'market'
        : undefined,
    question: /\b(fee|fees|charge|charges)\b/.test(value)
      ? 'fees'
      : /\b(card|cards|reward|rewards)\b/.test(value)
        ? 'cards'
        : amountMatch ||
            /\b(order|orders|voucher|vouchers|amazon|myntra|lifestyle|croma)\b/.test(
              value,
            )
          ? 'orders'
          : 'help',
  }
}
