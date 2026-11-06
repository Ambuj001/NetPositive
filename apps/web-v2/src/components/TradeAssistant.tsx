import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  ArrowUpRight,
  CreditCard,
  ExternalLink,
  Maximize2,
  MessageCircle,
  Minimize2,
  RotateCcw,
  X,
} from 'lucide-react'
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { Link } from 'react-router-dom'
import {
  AssistantFlow,
  QUICK_STORES,
  type AssistantMode,
  type ChatBlock,
} from '../lib/assistant-flow'
import {
  POPULAR_CARDS,
  userIdFor,
  type Draft,
  type FulfilOption,
  type Tile,
} from '../lib/chatbot'
import { brand } from '../lib/data'
import type { Order } from '../lib/data'
import { inr, quote, usdt } from '../lib/engine'
import { safeUrl } from '../lib/vouchers'
import { useApp } from '../lib/store'
import { BrandMark, cx } from './ui'
import { OrderLifecycle } from './OrderLifecycle'

type Props = {
  mode: AssistantMode
  active: boolean
  expanded: boolean
  setExpanded: (expanded: boolean) => void
  orders: Order[]
  source: string
  rate: number
  onStore: (store: Tile) => void
  onDraft: (draft: Draft) => void
  onPost: (draft: Draft) => Promise<Order | null>
  onSelectRequest: (order: Order) => void
  onSelectRoute: (order: Order, route: FulfilOption | null) => void
  localCommand: (text: string) => string | null
  external?: { key: number; order?: Order; store?: Tile }
}
export function TradeAssistant(props: Props) {
  const { fullAddress, cards, syncAssistantCards } = useApp()
  const [guestId] = useState(() => `guest_${crypto.randomUUID()}`)
  const [known, setKnown] = useState<Record<string, Order>>({})
  const current = useRef(props)
  current.current = props
  const app = useRef({ syncAssistantCards })
  app.current = { syncAssistantCards }
  const [flow] = useState(
    () =>
      new AssistantFlow(props.mode, userIdFor(fullAddress || guestId), {
        onStore: (store) => current.current.onStore(store),
        onDraft: (draft) => current.current.onDraft(draft),
        onPost: async (draft) => {
          const order = await current.current.onPost(draft)
          if (order) setKnown((all) => ({ ...all, [order.id]: order }))
          return order?.id ?? null
        },
        onRequest: (id) => {
          const order = current.current.orders.find((o) => o.id === id)
          if (!order) return null
          current.current.onSelectRequest(order)
          return {
            brand: order.brandName || brand(order.brandId).name,
            amount: order.amount,
          }
        },
        onPortfolio: (names) => app.current.syncAssistantCards(names),
        localCommand: (text) => current.current.localCommand(text),
      }),
  )
  const state = useSyncExternalStore(
    flow.subscribe,
    flow.snapshot,
    flow.snapshot,
  )
  const [input, setInput] = useState('')
  const scroll = useRef<HTMLDivElement>(null)
  const externalKey = useRef<number | null>(null)
  useEffect(() => {
    flow.activate()
    return () => flow.dispose()
  }, [flow])
  useEffect(() => {
    if (
      props.active &&
      props.expanded &&
      !state.messages.length &&
      !state.busy &&
      state.online === null
    )
      void flow.start()
  }, [props.active, props.expanded, flow])
  useEffect(() => {
    if (
      !props.active ||
      !props.external ||
      externalKey.current === props.external.key ||
      flow.state.busy
    )
      return
    externalKey.current = props.external.key
    if (props.external.order) {
      const order = props.external.order
      setKnown((all) => ({ ...all, [order.id]: order }))
      flow.trackOrder(order.id)
    } else if (props.external.store) flow.pickStore(props.external.store)
  }, [props.external, props.active, state.busy, flow])
  useEffect(() => {
    if (props.expanded)
      scroll.current?.scrollTo({
        top: scroll.current.scrollHeight,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
          ? 'auto'
          : 'smooth',
      })
  }, [state.messages, state.busy, props.expanded])
  const last: Partial<Record<ChatBlock['kind'], string>> = {}
  state.messages.forEach((m) =>
    m.blocks.forEach((b) => {
      last[b.kind] = m.id
    }),
  )
  const steps: Partial<Record<ChatBlock['kind'], string[]>> = {
    tiles: ['pick_store', 'ask_item'],
    draft: ['confirm'],
    portfolio: ['cards'],
    requests: ['pick_request', 'options'],
    options: ['options'],
  }
  const actionable = (id: string, b: ChatBlock) =>
    !state.busy &&
    last[b.kind] === id &&
    (!steps[b.kind] || steps[b.kind]!.includes(state.step))
  const submit = () => {
    const text = input.trim()
    if (!text || state.busy) return
    setInput('')
    props.setExpanded(true)
    void flow.send(text)
  }
  const getOrder = (id: string) =>
    props.orders.find((o) => o.id === id) || known[id]
  const block = (b: ChatBlock, id: string) => {
    const enabled = actionable(id, b)
    if (b.kind === 'text')
      return (
        <div className="assistant-copy">
          <RichText text={b.text} />
        </div>
      )
    if (b.kind === 'offline')
      return (
        <div className="chat-callout">
          <MessageCircle size={17} />
          <div>
            <strong>Recommendation service unavailable.</strong>
            <p>Your order controls and local helper still work.</p>
            <button
              className="np-text-link"
              disabled={state.busy}
              onClick={() => void flow.start()}
            >
              Reconnect
              <RotateCcw size={13} />
            </button>
          </div>
        </div>
      )
    if (b.kind === 'tiles') {
      const data = b.data
      const tiles =
        data.mode === 'store_locked'
          ? [
              ...(data.selected ? [data.selected] : []),
              ...(data.alternatives ?? []),
            ]
          : (data.tiles ?? [])
      return (
        <div className="assistant-stores">
          {tiles.map((t) => (
            <button
              key={t.merchant_id}
              disabled={!enabled}
              onClick={() => flow.pickStore(t)}
            >
              <BrandMark id={t.merchant_id} name={t.name} size={29} />
              <span>
                <strong>{t.name}</strong>
                <small>{t.site}</small>
              </span>
              <ArrowUpRight size={13} />
            </button>
          ))}
        </div>
      )
    }
    if (b.kind === 'draft') {
      const r = b.data.request,
        q = quote(r.amount_inr, props.rate)
      return (
        <div className="assistant-draft">
          <div className="panel-heading">
            <BrandMark id={r.merchant_id} name={r.merchant} size={34} />
            <div>
              <strong>{r.voucher_brand}</strong>
              <small>{r.item || r.merchant}</small>
            </div>
            <strong>{inr(r.amount_inr)}</strong>
          </div>
          <div className="calculator-lines">
            {[
              ['Vouchers', r.suggested_split.map((v) => inr(v)).join(' + ')],
              ['Rate', `${inr(props.rate, 2)} / USDC`],
              ['Crypto amount', `${usdt(q.buyerReceives)} USDC`],
              ['Seller fee · 1%', `${usdt(q.fee)} USDC`],
              ['Total', `${usdt(q.sellerLocks)} USDC`],
            ].map(([k, v]) => (
              <div key={k}>
                <span>{k}</span>
                <strong>{v}</strong>
              </div>
            ))}
          </div>
          <div className="button-row">
            <button
              className="np-button compact"
              disabled={!enabled}
              onClick={() => void flow.post()}
            >
              {props.source === 'live'
                ? 'Create request'
                : 'Save preview request'}
              <ArrowRight size={14} />
            </button>
            <button
              className="np-button ghost compact"
              disabled={!enabled}
              onClick={() => flow.changeAmount()}
            >
              Change amount
            </button>
          </div>
          <p className="field-hint">
            {props.source === 'live'
              ? 'A request is published only after the account service confirms its escrow deposit.'
              : 'No funds move in preview.'}
          </p>
        </div>
      )
    }
    if (b.kind === 'posted' || b.kind === 'tracking') {
      const order = getOrder(b.orderId)
      return order ? (
        <OrderLifecycle key={`${order.id}:${fullAddress}`} order={order} />
      ) : (
        <div className="chat-callout">
          <span>Request {b.orderId}</span>
          <button
            className="np-text-link"
            onClick={() =>
              props.onSelectRequest({
                id: b.orderId,
                brandId: 'voucher',
                amount: 0,
                rate: 0,
                seller: '',
                sellerTrades: 0,
                city: '',
                postedMin: 0,
                expiresMin: 0,
                source: 'live',
              })
            }
          >
            Track request
            <ArrowRight size={13} />
          </button>
        </div>
      )
    }
    if (b.kind === 'portfolio')
      return (
        <div className="assistant-portfolio">
          {(enabled ? state.portfolio : b.cards).map((name) => (
            <span key={name}>
              <CreditCard size={13} />
              {name}
              {enabled && (
                <button
                  className="icon-button"
                  aria-label={`Remove ${name}`}
                  onClick={() => void flow.removeCard(name)}
                >
                  <X size={12} />
                </button>
              )}
            </span>
          ))}
          {!state.portfolio.length && enabled && (
            <span className="subtle-label">No cards selected.</span>
          )}
        </div>
      )
    if (b.kind === 'requests') {
      const open = props.orders.filter(
        (o) => o.seller !== 'you' && o.seller.toLowerCase() !== fullAddress,
      )
      return (
        <div className="assistant-requests">
          <span className="subtle-label">
            {props.source === 'live' ? 'Funded requests' : 'Sample requests'}
          </span>
          {open.slice(0, 10).map((o) => (
            <button
              key={o.id}
              disabled={!enabled}
              onClick={() => void flow.pickRequest(o.id)}
            >
              <BrandMark id={o.brandId} name={o.brandName} size={28} />
              <span>
                <strong>{o.brandName || brand(o.brandId).name}</strong>
                <small>
                  {inr(o.amount)} · {usdt(o.amount / o.rate)} USDC
                </small>
              </span>
              <ArrowRight size={14} />
            </button>
          ))}
          {!open.length && (
            <p className="field-hint">No open requests right now.</p>
          )}
        </div>
      )
    }
    if (b.kind === 'options') {
      const f = b.data
      return (
        <div className="assistant-options">
          {f.options.map((option) => (
            <RouteOption
              key={`${option.rank}:${option.card}:${option.channel}`}
              option={option}
              enabled={enabled}
              onSelect={() => {
                const order = getOrder(b.orderId)
                if (order) props.onSelectRoute(order, option)
                flow.chooseRoute(b.orderId, option)
              }}
            />
          ))}
          <div className="chat-requirements">
            <strong>Must match: {f.must_match.voucher_brand}</strong>
            <span>
              {inr(f.must_match.total_amount_inr)} total ·{' '}
              {f.must_match.suggested_split.map((v) => inr(v)).join(' + ')}
            </span>
            {f.no_data_for_cards.length > 0 && (
              <p>No researched route: {f.no_data_for_cards.join(', ')}</p>
            )}
            {f.notes.map((note, i) => (
              <p key={i}>{note}</p>
            ))}
            {safeUrl(f.second_option.url) && (
              <a
                href={safeUrl(f.second_option.url)}
                target="_blank"
                rel="noreferrer"
              >
                {f.second_option.name}
                <ExternalLink size={12} />
              </a>
            )}
          </div>
          <button
            className="np-button secondary compact"
            disabled={!enabled}
            onClick={() => {
              const order = getOrder(b.orderId)
              if (order) props.onSelectRoute(order, null)
              flow.chooseRoute(b.orderId, null)
            }}
          >
            Use my own card or portal
            <ArrowRight size={14} />
          </button>
          <button
            className="np-text-link"
            disabled={state.busy}
            onClick={() => flow.showRequests()}
          >
            See other requests
          </button>
        </div>
      )
    }
    if (b.kind === 'purchase') {
      const order = getOrder(b.orderId)
      return order ? (
        <Purchase
          key={`${b.orderId}:${id}:${fullAddress}`}
          order={order}
          route={b.route}
        />
      ) : (
        <p className="field-hint">
          This request is no longer available. Refresh the order book.
        </p>
      )
    }
  }
  const quick =
    props.mode === 'sell'
      ? state.step === 'ask_item'
        ? ['Nike shoes', 'Groceries', 'Shoes from Myntra']
        : state.step === 'ask_amount'
          ? ['₹2,000', '₹5,000', '₹10,000', '₹25,000']
          : []
      : state.step === 'cards'
        ? POPULAR_CARDS.filter((c) => !state.portfolio.includes(c)).slice(0, 4)
        : []
  return (
    <section
      hidden={!props.active}
      className={cx(
        'trade-chat integrated-assistant',
        props.expanded && 'expanded',
      )}
      aria-label={`${props.mode === 'sell' ? 'Pay with crypto' : 'Buy'} assistant`}
      onClick={() => {
        if (!props.expanded) props.setExpanded(true)
      }}
    >
      <div className="chat-panel-heading">
        <span>
          <MessageCircle size={16} />
          NetPositive
          <span
            className={cx(
              'assistant-connection',
              state.online === true && 'online',
            )}
            title={
              state.online === true
                ? 'Recommendation service connected'
                : 'Local helper available'
            }
          />
        </span>
        <div className="button-row">
          <button
            className="icon-button"
            disabled={state.busy}
            aria-label="Restart conversation"
            onClick={() => void flow.reset()}
          >
            <RotateCcw size={14} />
          </button>
          <button
            className="icon-button"
            onClick={() => props.setExpanded(!props.expanded)}
            aria-expanded={props.expanded}
            aria-label={props.expanded ? 'Collapse chat' : 'Expand chat'}
          >
            {props.expanded ? <Minimize2 size={15} /> : <Maximize2 size={15} />}
          </button>
        </div>
      </div>
      <AnimatePresence initial={false}>
        {props.expanded && (
          <motion.div
            className="chat-conversation"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 460, opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          >
            <div
              className="chat-log"
              ref={scroll}
              role="log"
              aria-live="polite"
            >
              {state.messages.length ? (
                state.messages.map((m) => (
                  <div key={m.id} className={cx('assistant-message', m.from)}>
                    {m.blocks.map((b, i) => (
                      <div key={i}>{block(b, m.id)}</div>
                    ))}
                  </div>
                ))
              ) : (
                <div className="chat-welcome">
                  <MessageCircle size={24} />
                  <p>
                    {props.mode === 'sell'
                      ? 'What would you like to buy?'
                      : 'Make more of your cards.'}
                  </p>
                  <span>Preparing your guided workspace.</span>
                </div>
              )}
              {props.mode === 'sell' && state.step === 'ask_item' && (
                <div className="quick-store-shortcuts">
                  {QUICK_STORES.map((t) => (
                    <button
                      key={t.merchant_id}
                      disabled={state.busy}
                      onClick={() => flow.pickStore(t)}
                    >
                      <BrandMark id={t.merchant_id} name={t.name} size={21} />
                      {t.name}
                    </button>
                  ))}
                </div>
              )}
              {state.busy && (
                <div className="typing-dots" aria-label="Preparing reply">
                  <i />
                  <i />
                  <i />
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <form
        className="chat-composer"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <textarea
          aria-label="Message NetPositive"
          placeholder={
            props.mode === 'sell' && state.step === 'ask_amount'
              ? 'Enter the voucher value…'
              : props.mode === 'buy' && state.step === 'cards'
                ? 'Add a card, or ask about your order…'
                : 'Ask about a store, order, or your cards…'
          }
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onFocus={() => props.setExpanded(true)}
          maxLength={700}
          rows={2}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault()
              submit()
            }
          }}
        />
        <button
          className="chat-send"
          type="submit"
          disabled={!input.trim() || state.busy}
          aria-label="Send message"
        >
          <ArrowRight size={19} />
        </button>
      </form>
      <div className="chat-suggestions">
        {quick.map((text) => (
          <button
            disabled={state.busy}
            key={text}
            onClick={() => {
              props.setExpanded(true)
              if (props.mode === 'buy') void flow.addCard(text)
              else if (state.step === 'ask_amount')
                void flow.amount(Number(text.replace(/[₹,]/g, '')))
              else void flow.search(text)
            }}
          >
            {props.mode === 'buy' ? '+ ' : ''}
            {text}
            <ArrowUpRight size={11} />
          </button>
        ))}
        {props.mode === 'buy' && (
          <>
            <button
              disabled={state.busy}
              onClick={() => {
                props.setExpanded(true)
                flow.showRequests()
              }}
            >
              Find requests
              <ArrowRight size={12} />
            </button>
            {state.step === 'cards' && cards.length > 0 && (
              <button
                disabled={state.busy}
                onClick={() => {
                  props.setExpanded(true)
                  void flow.usePortfolio(
                    cards.map((c) => `${c.issuer} ${c.name}`.trim()),
                  )
                }}
              >
                Use my saved cards
              </button>
            )}
          </>
        )}
        {props.mode === 'sell' && state.step === 'confirm' && (
          <button disabled={state.busy} onClick={() => flow.changeAmount()}>
            Change amount
          </button>
        )}
        <button
          disabled={state.busy}
          onClick={() => {
            props.setExpanded(true)
            void flow.send('How fees work')
          }}
        >
          How fees work
        </button>
        <Link to="/cards">
          My cards
          <ArrowUpRight size={11} />
        </Link>
      </div>
    </section>
  )
}
function RichText({ text }: { text: string }) {
  return (
    <>
      {text.split(/(\*\*[^*]+\*\*|https?:\/\/[^\s)]+)/g).map((s, i) =>
        s.startsWith('**') ? (
          <strong key={i}>{s.slice(2, -2)}</strong>
        ) : safeUrl(s) ? (
          <a key={i} href={safeUrl(s)} target="_blank" rel="noreferrer">
            {s}
          </a>
        ) : (
          <span key={i}>{s}</span>
        ),
      )}
    </>
  )
}
function RouteOption({
  option,
  enabled,
  onSelect,
}: {
  option: FulfilOption
  enabled: boolean
  onSelect: () => void
}) {
  return (
    <div className={cx('assistant-route', option.best && 'best')}>
      <div className="panel-heading">
        <span className="route-rank">{option.rank}</span>
        <div>
          <strong>{option.card}</strong>
          <small>{option.channel}</small>
        </div>
        <div className="route-reward">
          <strong>{option.expected_value_pct}%</strong>
          <small>≈{inr(option.expected_value_rupees)}</small>
        </div>
      </div>
      <div className="route-provenance">
        <span className="status-badge">
          {option.verified ? option.grade : 'Confirm terms'}
        </span>
        <span>{option.checked_on || 'Date not supplied'}</span>
      </div>
      {option.steps.length > 0 && (
        <ol>
          {option.steps.map((s, i) => (
            <li key={i}>{s}</li>
          ))}
        </ol>
      )}
      {option.note && <p className="field-hint">{option.note}</p>}
      {option.portal_note && <p className="field-hint">{option.portal_note}</p>}
      <div className="button-row">
        {safeUrl(option.link) && (
          <a
            className="np-button secondary compact"
            href={safeUrl(option.link)}
            target="_blank"
            rel="noreferrer"
          >
            Open {option.portal || 'portal'}
            <ExternalLink size={12} />
          </a>
        )}
        <button
          disabled={!enabled}
          className="np-button compact"
          onClick={onSelect}
        >
          Use this route
          <ArrowRight size={13} />
        </button>
      </div>
      {option.source && <p className="field-hint">Source: {option.source}</p>}
    </div>
  )
}
function Purchase({
  order,
  route,
}: {
  order: Order
  route: FulfilOption | null
}) {
  const [custom, setCustom] = useState({ card: '', portal: '', reward: '' })
  const [confirmed, setConfirmed] = useState(!!route)
  return (
    <div className="stack">
      {!route && !confirmed && (
        <form
          className="stack assistant-custom-route"
          onSubmit={(e) => {
            e.preventDefault()
            setConfirmed(true)
          }}
        >
          <h3>Your purchase route</h3>
          <label className="np-field">
            <span>Card</span>
            <input
              value={custom.card}
              onChange={(e) =>
                setCustom((v) => ({ ...v, card: e.target.value }))
              }
              required
              minLength={2}
              maxLength={80}
            />
          </label>
          <label className="np-field">
            <span>Portal or store</span>
            <input
              value={custom.portal}
              onChange={(e) =>
                setCustom((v) => ({ ...v, portal: e.target.value }))
              }
              required
              minLength={2}
              maxLength={100}
            />
          </label>
          <label className="np-field">
            <span>Expected reward % (optional)</span>
            <input
              type="number"
              min={0}
              max={50}
              step=".01"
              value={custom.reward}
              onChange={(e) =>
                setCustom((v) => ({ ...v, reward: e.target.value }))
              }
            />
          </label>
          <p className="field-hint">
            Your estimate. Brand and total voucher value must match.
          </p>
          <button className="np-button compact">
            Continue
            <ArrowRight size={14} />
          </button>
        </form>
      )}
      {confirmed && (
        <>
          {!route && (
            <div className="purchase-route-label">
              {custom.card} · {custom.portal}
              {custom.reward ? ` · ${custom.reward}% estimate` : ''}
            </div>
          )}
          <OrderLifecycle order={order} route={route} />
        </>
      )}
    </div>
  )
}
