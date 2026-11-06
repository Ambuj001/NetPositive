import { useMemo, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import { useApp } from '../lib/store'
import { inr, netRate, quote, routesFor, usdt } from '../lib/engine'
export function RateCalculator({
  amount,
  receive,
  seller = false,
  rate = 90,
  serviceEstimate,
  clearServiceEstimate,
}: {
  amount: number
  receive: number
  seller?: boolean
  rate?: number
  serviceEstimate?: {
    label: string
    channel: string
    rewardInr: number
    checkedOn: string
  }
  clearServiceEstimate?: () => void
}) {
  const { cards } = useApp()
  const [valuation, setValuation] = useState<'statement' | 'travel'>(
    'statement',
  )
  const [cardId, setCardId] = useState('all')
  const [open, setOpen] = useState(true)
  const routes = useMemo(
    () =>
      routesFor(
        amount,
        cardId === 'all' || !cards.some((c) => c.id === cardId)
          ? cards
          : cards.filter((c) => c.id === cardId),
      ).sort((a, b) =>
        valuation === 'statement'
          ? b.statementInr - a.statementInr
          : b.travelInr - a.travelInr,
      ),
    [amount, cards, cardId, valuation],
  )
  const best = routes[0]
  const reward = serviceEstimate
    ? serviceEstimate.rewardInr
    : best
      ? valuation === 'statement'
        ? best.statementInr
        : best.travelInr
      : 0
  const sell = quote(amount || 0, rate > 0 ? rate : 1)
  const effective = seller
    ? netRate(amount, sell.sellerLocks)
    : netRate(amount, receive, Math.min(amount, reward))
  return (
    <section className="rate-calculator">
      <button
        type="button"
        className="calculator-toggle"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        <span>Net effective rate</span>
        <ChevronDown
          size={15}
          style={{ transform: open ? 'rotate(180deg)' : undefined }}
        />
      </button>
      {open && (
        <div className="calculator-content">
          {!seller && !serviceEstimate && (
            <>
              <div className="calculator-select">
                <select
                  aria-label="Card for effective rate"
                  value={cards.some((c) => c.id === cardId) ? cardId : 'all'}
                  onChange={(e) => setCardId(e.target.value)}
                >
                  <option value="all">Best of my cards</option>
                  {cards.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.issuer} {c.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="mini-segment" aria-label="Reward valuation">
                {(['statement', 'travel'] as const).map((v) => (
                  <button
                    key={v}
                    type="button"
                    onClick={() => setValuation(v)}
                    aria-pressed={valuation === v}
                  >
                    {v === 'statement' ? 'Cash value' : 'Travel value'}
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="calculator-lines">
            {seller ? (
              <>
                <div>
                  <span>Voucher value</span>
                  <strong>{inr(amount)}</strong>
                </div>
                <div>
                  <span>USDC including 1% fee</span>
                  <strong>{usdt(sell.sellerLocks)}</strong>
                </div>
              </>
            ) : (
              <>
                <div>
                  <span>Voucher spend</span>
                  <strong>{inr(amount)}</strong>
                </div>
                <div>
                  <span>Estimated rewards</span>
                  <strong>−{inr(reward, 2)}</strong>
                </div>
                {serviceEstimate && (
                  <div className="calculator-route">
                    {serviceEstimate.label} · {serviceEstimate.channel}
                    <br />
                    Service travel-value estimate
                  </div>
                )}
                {!serviceEstimate && best && (
                  <div className="calculator-route">
                    {best.cardLabel} · {best.channel.name}
                  </div>
                )}
              </>
            )}
          </div>
          <div className="calculator-result">
            <strong>{effective === null ? '—' : inr(effective, 2)}</strong>
            <span>/ USDC</span>
          </div>
          <p className="field-hint">
            {seller
              ? 'Voucher value ÷ total USDC, including the fee.'
              : serviceEstimate
                ? `Recommendation service data checked ${serviceEstimate.checkedOn || 'on an unspecified date'}. Confirm terms and redemption value.`
                : 'Illustrative card rates. Based on your selected reward value; issuer terms and caps apply.'}
          </p>
          {serviceEstimate && (
            <button
              type="button"
              className="np-text-link"
              onClick={clearServiceEstimate}
            >
              Use local card assumptions
            </button>
          )}
        </div>
      )}
    </section>
  )
}
