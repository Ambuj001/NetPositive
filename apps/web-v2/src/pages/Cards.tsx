import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Check, CreditCard, Plus, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { Dialog } from '../components/Dialog'
import { cx } from '../components/ui'
import { CARDS, inr, routesFor, type Card } from '../lib/engine'
import { useApp } from '../lib/store'
export default function Cards() {
  const { cards, setCards, toast } = useApp()
  const [selected, setSelected] = useState(cards[0]?.id || '')
  const [adding, setAdding] = useState(false)
  const [error, setError] = useState('')
  const [custom, setCustom] = useState({
    issuer: '',
    name: '',
    points: '1',
    unit: '100',
    cash: '1',
    travel: '1',
  })
  const card = cards.find((c) => c.id === selected) ?? cards[0]
  const [redemption, setRedemption] = useState<'statement' | 'travel'>(
    'statement',
  )
  const routes = card
    ? routesFor(10000, [card]).sort((a, b) =>
        redemption === 'statement'
          ? b.statementInr - a.statementInr
          : b.travelInr - a.travelInr,
      )
    : []
  const save = (next: Card[]) => {
    try {
      setCards(next)
      setError('')
      return true
    } catch (e) {
      setError((e as Error).message)
      return false
    }
  }
  const add = (c: Card) => {
    if (save(cards.some((x) => x.id === c.id) ? cards : [...cards, c])) {
      setSelected(c.id)
      setAdding(false)
    }
  }
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Your portfolio</span>
          <h1>Make every card count.</h1>
          <p>Save card variants and reward assumptions. No card numbers.</p>
        </div>
        <button className="np-button" onClick={() => setAdding(true)}>
          <Plus size={16} />
          Add card
        </button>
      </div>
      {error && (
        <p role="alert" className="form-error">
          {error}
        </p>
      )}
      <div className="cards-layout">
        <section className="np-panel card-portfolio">
          <div className="panel-heading">
            <h2>My cards</h2>
            <span className="subtle-label">{cards.length} saved</span>
          </div>
          <div className="card-stack">
            {cards.map((c, i) => (
              <motion.button
                key={c.id}
                className={cx(
                  'portfolio-card',
                  c.id === card?.id && 'selected',
                )}
                style={{
                  background: [
                    'linear-gradient(130deg,#173d32,#315b4d)',
                    'linear-gradient(130deg,#392d37,#704959)',
                    'linear-gradient(130deg,#233c50,#466d83)',
                  ][i % 3],
                }}
                onClick={() => setSelected(c.id)}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                whileHover={{ y: -4 }}
                transition={{ duration: 0.25 }}
              >
                <span>{c.issuer}</span>
                <CreditCard size={23} />
                <strong>{c.name}</strong>
                <small>{c.last || 'Reward profile'}</small>
                {c.id === card?.id && (
                  <Check className="card-selected" size={17} />
                )}
              </motion.button>
            ))}
            {!cards.length && (
              <div className="empty-state">
                <CreditCard size={25} />
                <h3>Your portfolio starts here.</h3>
                <button
                  className="np-button secondary"
                  onClick={() => setAdding(true)}
                >
                  Add your first card
                </button>
              </div>
            )}
          </div>
          <p className="field-hint">
            Saved in this browser, separately for each connected wallet. Example
            cards use illustrative rates.
          </p>
        </section>
        <AnimatePresence mode="wait">
          {card && (
            <motion.section
              key={card.id}
              className="card-detail stack"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -5 }}
            >
              <div className="np-panel padded">
                <div className="panel-heading">
                  <h2>
                    {card.issuer} {card.name}
                  </h2>
                  <button
                    className="icon-button"
                    aria-label={`Remove ${card.name}`}
                    onClick={() => {
                      save(cards.filter((c) => c.id !== card.id))
                      toast({ title: 'Card removed' })
                    }}
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
                <div className="reward-stat">
                  <strong>{card.pointsPer}</strong>
                  <span>points per {inr(card.spendUnit)}</span>
                </div>
                <div className="detail-grid">
                  <div>
                    <span>Cash value</span>
                    <strong>{inr(card.statementValue, 2)} / point</strong>
                  </div>
                  <div>
                    <span>Travel value</span>
                    <strong>{inr(card.travelValue, 2)} / point</strong>
                  </div>
                </div>
              </div>
              <div className="np-panel padded">
                <div className="panel-heading">
                  <h2>Bonus cap used</h2>
                  <span className="subtle-label">
                    {card.bonusCap
                      ? `${card.bonusUsed.toLocaleString('en-IN')} / ${card.bonusCap.toLocaleString('en-IN')} pts`
                      : 'No bonus cap entered'}
                  </span>
                </div>
                {card.bonusCap > 0 && (
                  <>
                    <input
                      type="range"
                      min={0}
                      max={card.bonusCap}
                      value={card.bonusUsed}
                      aria-label="Bonus points used this month"
                      onChange={(e) =>
                        save(
                          cards.map((c) =>
                            c.id === card.id
                              ? { ...c, bonusUsed: Number(e.target.value) }
                              : c,
                          ),
                        )
                      }
                      className="np-range"
                    />
                    <p className="field-hint">
                      Update after purchases. Reset manually at the start of
                      your reward period.
                    </p>
                    <button
                      className="text-control"
                      onClick={() =>
                        save(
                          cards.map((c) =>
                            c.id === card.id ? { ...c, bonusUsed: 0 } : c,
                          ),
                        )
                      }
                    >
                      Reset used points
                    </button>
                  </>
                )}
              </div>
              <div className="np-panel padded">
                <div className="panel-heading">
                  <h2>On a ₹10,000 voucher</h2>
                  <div className="mini-segment">
                    {(['statement', 'travel'] as const).map((v) => (
                      <button
                        key={v}
                        onClick={() => setRedemption(v)}
                        aria-pressed={redemption === v}
                      >
                        {v === 'statement' ? 'Cash' : 'Travel'}
                      </button>
                    ))}
                  </div>
                </div>
                {routes.map((r) => (
                  <div className="profile-row" key={r.channel.id}>
                    <div>
                      <strong>{r.channel.name}</strong>
                      <small>
                        {r.points.toLocaleString('en-IN')} pts · {r.txns}{' '}
                        purchase{r.txns > 1 ? 's' : ''}
                      </small>
                    </div>
                    <strong className="green">
                      {(redemption === 'statement'
                        ? r.pctStatement
                        : r.pctTravel
                      ).toFixed(2)}
                      %
                    </strong>
                  </div>
                ))}
                <Link className="np-text-link" to="/home">
                  Compare in Trade
                  <ArrowUpRight size={15} />
                </Link>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </div>
      {adding && (
        <Dialog title="Add a card" close={() => setAdding(false)}>
          <div className="stack">
            {CARDS.filter((c) => !cards.some((x) => x.id === c.id)).map((c) => (
              <button
                className="wallet-choice"
                key={c.id}
                onClick={() => add(c)}
              >
                <CreditCard size={22} />
                <span>
                  <strong>
                    {c.issuer} {c.name}
                  </strong>
                  <small>Example reward profile</small>
                </span>
                <Plus size={16} />
              </button>
            ))}
            <form
              className="stack custom-card-form"
              onSubmit={(e) => {
                e.preventDefault()
                const p = Number(custom.points),
                  u = Number(custom.unit),
                  cash = Number(custom.cash),
                  travel = Number(custom.travel)
                if (
                  !custom.issuer.trim() ||
                  !custom.name.trim() ||
                  ![p, u, cash, travel].every(Number.isFinite) ||
                  p < 0 ||
                  p > 100 ||
                  u <= 0 ||
                  cash < 0 ||
                  travel < 0 ||
                  cash > 100 ||
                  travel > 100 ||
                  p * Math.max(cash, travel) > u
                ) {
                  setError('Enter valid card and reward values.')
                  return
                }
                add({
                  id: crypto.randomUUID(),
                  issuer: custom.issuer.trim(),
                  name: custom.name.trim(),
                  last: 'Custom',
                  gradient: '',
                  pointsPer: p,
                  spendUnit: u,
                  travelValue: travel,
                  statementValue: cash,
                  bonusCap: 0,
                  bonusUsed: 0,
                  channels: [
                    {
                      id: 'direct',
                      name: 'Direct',
                      multiplier: 1,
                      denomination: 10000,
                      note: 'Your reward assumptions',
                    },
                  ],
                })
              }}
            >
              <h3>Or enter your own</h3>
              <div className="form-grid">
                {(
                  [
                    ['issuer', 'Issuer'],
                    ['name', 'Card name'],
                    ['points', 'Base points'],
                    ['unit', 'Per spend (₹)'],
                    ['cash', 'Cash value / point (₹)'],
                    ['travel', 'Travel value / point (₹)'],
                  ] as const
                ).map(([key, label]) => (
                  <label className="np-field" key={key}>
                    <span>{label}</span>
                    <input
                      required
                      maxLength={60}
                      type={
                        key === 'issuer' || key === 'name' ? 'text' : 'number'
                      }
                      min={key === 'unit' ? 0.01 : 0}
                      step="any"
                      value={custom[key]}
                      onChange={(e) =>
                        setCustom((c) => ({ ...c, [key]: e.target.value }))
                      }
                    />
                  </label>
                ))}
              </div>
              {error && (
                <p role="alert" className="form-error">
                  {error}
                </p>
              )}
              <button className="np-button" type="submit">
                Save card
              </button>
            </form>
          </div>
        </Dialog>
      )}
    </div>
  )
}
