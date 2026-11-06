import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  ChevronDown,
  CreditCard,
  Search,
  X,
} from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BrandMark, cx } from '../components/ui'
import { Dialog } from '../components/Dialog'
import { RateCalculator } from '../components/RateCalculator'
import { BRANDS, brand } from '../lib/data'
import type { Draft, Tile, FulfilOption } from '../lib/chatbot'
import { TradeAssistant } from '../components/TradeAssistant'
import { useOrderBook, useMyRequests } from '../lib/orderbook'
import { orderApi, toOrder, STATUS } from '../lib/order-api'
import type { Order } from '../lib/data'
import { inr, quote, usdt } from '../lib/engine'
import { useApp } from '../lib/store'
import {
  BUY_INTENTS,
  bestSellRate,
  parseTradingMessage,
  previewBuy,
  type OrderType,
  type TradeMode,
} from '../lib/trading'

const spring = { type: 'spring' as const, stiffness: 330, damping: 32 }
export default function Home() {
  const [params, setParams] = useSearchParams()
  const mode: TradeMode = params.get('mode') === 'sell' ? 'sell' : 'buy'
  const {
    address,
    fullAddress,
    orders: localOrders,
    addPreviewVoucher,
    token,
    signIn,
    humanVerified,
    openWallet,
    workspaceOrders,
    saveWorkspaceOrder,
    cancelWorkspaceOrder,
  } = useApp()
  const { orders, source } = useOrderBook()
  const mine = useMyRequests()
  const [trackingError, setTrackingError] = useState('')
  const liveMine =
    mode === 'sell'
      ? (mine.rows?.asRequester ?? [])
      : (mine.rows?.asFulfiller ?? [])
  const [guideOrder, setGuideOrder] = useState<Order | null>(null)
  const [guideRoute, setGuideRoute] = useState<{
    order: Order
    route: FulfilOption
  } | null>(null)
  const [merchant, setMerchant] = useState<Tile | null>(null)
  const [external, setExternal] = useState<{
    key: number
    mode: TradeMode
    order?: Order
    store?: Tile
  }>()
  const [tab, setTab] = useState<'market' | 'orders'>('market')
  const [search, setSearch] = useState('')
  const requestedOrder =
    guideOrder || orders.find((o) => o.id === params.get('request'))
  const [amounts, setAmounts] = useState({
    buy: String(requestedOrder?.amount ?? 10000),
    sell: '10000',
  })
  const [types, setTypes] = useState<Record<TradeMode, OrderType>>({
    buy: 'market',
    sell: 'market',
  })
  const [limits, setLimits] = useState({ buy: '90', sell: '90' })
  const [slippage, setSlippage] = useState(1)
  const [brandId, setBrandId] = useState('lifestyle')
  const [review, setReview] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [matchedIds, setMatchedIds] = useState<string[]>([])
  const [waiting, setWaiting] = useState(false)
  const amount = Number(amounts[mode]),
    limit = Number(limits[mode]),
    orderType = types[mode]
  const validAmount =
    Number.isFinite(amount) &&
    amount >= 100 &&
    amount <= 200000 &&
    Math.abs(amount * 100 - Math.round(amount * 100)) < 0.00001
  const validLimit =
    orderType === 'market' ||
    (Number.isFinite(limit) && limit >= 1 && limit <= 1000)
  const buy = useMemo(
    () =>
      previewBuy(
        requestedOrder ? [requestedOrder] : orders,
        validAmount ? amount : 0,
        orderType,
        limit,
        slippage,
      ),
    [orders, requestedOrder, amount, validAmount, orderType, limit, slippage],
  )
  const sellMatch = bestSellRate(BUY_INTENTS, brandId, amount, orderType, limit)
  const sellRate = orderType === 'limit' ? limit : (sellMatch?.rate ?? 90)
  const sell = quote(
    validAmount ? amount : 0,
    validLimit && sellRate > 0 ? sellRate : 1,
  )
  const filteredBrands = (
    merchant && !BRANDS.some((b) => b.id === merchant.merchant_id)
      ? [
          ...BRANDS,
          {
            id: merchant.merchant_id,
            name: merchant.name,
            category: merchant.category || 'Voucher',
            color: '#5a6170',
            glyph: merchant.name[0],
            domains: [],
          },
        ]
      : BRANDS
  ).filter((b) =>
    (b.name + b.category).toLowerCase().includes(search.toLowerCase()),
  )
  const filteredIntents = BUY_INTENTS.filter((o) =>
    brand(o.brandId).name.toLowerCase().includes(search.toLowerCase()),
  )
  const matched = orders.filter((o) => matchedIds.includes(o.id))
  const selectedOrders = workspaceOrders.filter((o) => o.mode === mode)
  const switchMode = (next: TradeMode) => {
    setParams(next === 'sell' ? { mode: 'sell' } : {}, { replace: true })
    setSearch('')
    setTab('market')
    setExpanded(false)
  }
  const localCommand = (text: string, chatMode: TradeMode) => {
    const intent = parseTradingMessage(text, BRANDS)
    if (intent.question === 'fees')
      return 'Buying has no platform fee. Pay with crypto has a 1% seller fee, shown before confirmation.'
    if (chatMode === 'buy' && intent.amount) {
      setAmounts((a) => ({ ...a, buy: String(intent.amount) }))
      if (intent.type) setTypes((t) => ({ ...t, buy: intent.type! }))
      return 'Your buying budget is updated in the order panel.'
    }
    if (intent.type && /order|switch|set|use/i.test(text)) {
      setTypes((t) => ({ ...t, [chatMode]: intent.type! }))
      return `Your order type is now ${intent.type}.`
    }
    return null
  }
  const setStore = (store: Tile) => {
    setMerchant(store)
    setBrandId(store.merchant_id)
  }
  const applyDraft = (draft: Draft) => {
    setAmounts((a) => ({ ...a, sell: String(draft.request.amount_inr) }))
    setBrandId(draft.request.merchant_id)
    setMerchant({
      merchant_id: draft.request.merchant_id,
      name: draft.request.merchant,
      voucher_brand: draft.request.voucher_brand,
      category: null,
      site: '',
    })
  }
  const postDraft = async (draft: Draft): Promise<Order | null> => {
    if (!address) {
      openWallet()
      return null
    }
    const d = draft.request
    const rate =
      types.sell === 'limit'
        ? Number(limits.sell)
        : (bestSellRate(BUY_INTENTS, d.merchant_id, d.amount_inr, 'market', 0)
            ?.rate ?? 90)
    if (!Number.isFinite(rate) || rate <= 0)
      throw new Error('Set a valid rate in the order panel.')
    if (source === 'live') {
      if (!humanVerified)
        throw new Error(
          'Connect World ID in Profile before creating a funded request.',
        )
      if (!Number.isInteger(d.amount_inr) || d.amount_inr > 100000)
        throw new Error(
          'The current account service supports whole-rupee requests up to ₹1,00,000.',
        )
      const t = token || (await signIn())
      const q = quote(d.amount_inr, rate)
      const result = await orderApi.create(
        t,
        d.merchant_id === 'mmt' ? 'makemytrip' : d.merchant_id,
        d.amount_inr,
        q.sellerLocks.toFixed(2),
      )
      return toOrder(result.request)
    }
    const id = addPreviewVoucher({
      merchantId: d.merchant_id,
      name: d.voucher_brand,
      amount: d.amount_inr,
      rate,
    })
    return id
      ? {
          id,
          brandId: d.merchant_id,
          brandName: d.voucher_brand,
          amount: d.amount_inr,
          rate,
          seller: 'you',
          sellerTrades: 0,
          city: '',
          postedMin: 0,
          expiresMin: 30,
          source: 'preview',
        }
      : null
  }
  const selectRequest = (order: Order) => {
    setAmounts((a) => ({ ...a, buy: String(order.amount) }))
    setGuideOrder(order)
    setGuideRoute(null)
    setMatchedIds([order.id])
    setWaiting(false)
  }
  const canSubmit =
    validAmount &&
    validLimit &&
    (mode === 'sell' || orderType === 'limit' || buy.fills.length > 0)
  const submit = () => {
    if (!canSubmit) return
    if (!address) {
      setReview(false)
      openWallet()
      return
    }
    const ids =
      mode === 'buy'
        ? buy.fills.map((o) => o.id)
        : sellMatch
          ? [sellMatch.id]
          : []
    saveWorkspaceOrder({
      mode,
      type: orderType,
      amount,
      limit: orderType === 'limit' ? limit : undefined,
      slippagePct: orderType === 'market' ? slippage : undefined,
      brandId: mode === 'sell' ? brandId : undefined,
      matchedIds: ids,
    })
    setReview(false)
    if (mode === 'buy') {
      setMatchedIds(ids)
      setWaiting(ids.length === 0)
    } else setTab('orders')
  }
  return (
    <div className="trade-home" data-mode={mode}>
      <div className="workspace-wrap">
        <div className="workspace-heading">
          <div className="workspace-title">
            <h1>Trade</h1>
            <span className="demo-label">
              {source === 'live' ? 'Connected' : 'Preview'}
            </span>
          </div>
          <div className="workspace-controls">
            <span className="workspace-currency">
              India <span>·</span> INR
            </span>
            <button
              className={cx(
                'workspace-orders-link',
                tab === 'orders' && 'active',
              )}
              onClick={() => setTab(tab === 'orders' ? 'market' : 'orders')}
            >
              My orders{' '}
              <span>
                {workspaceOrders.filter((o) => o.status === 'open').length}
              </span>
            </button>
          </div>
        </div>
        <div className="workspace-toolbar">
          <div className="mode-switch" role="group" aria-label="Trade mode">
            {(['buy', 'sell'] as const).map((v) => (
              <button
                key={v}
                aria-pressed={mode === v}
                onClick={() => switchMode(v)}
              >
                {mode === v && (
                  <motion.span
                    layoutId="trade-mode"
                    className="mode-switch-active"
                    transition={spring}
                  />
                )}
                <span>
                  {v === 'buy' ? (
                    <ArrowDownLeft size={16} />
                  ) : (
                    <ArrowUpRight size={16} />
                  )}
                  {v === 'buy' ? 'Buy' : 'Pay with crypto'}
                </span>
              </button>
            ))}
          </div>
          <span className="mode-description">
            {mode === 'buy'
              ? 'Buy USDC. Keep your card rewards.'
              : 'Choose a voucher. Pay with USDC.'}
          </span>
        </div>
        <div className="workspace-grid">
          <div className={cx('workspace-main', expanded && 'chat-expanded')}>
            <motion.section
              layout
              className="market-panel"
              transition={spring}
              aria-label={
                tab === 'orders'
                  ? 'My orders'
                  : mode === 'sell'
                    ? 'Vouchers and buyer orders'
                    : 'Order matching'
              }
            >
              <div className="market-panel-heading">
                <h2>
                  {tab === 'orders'
                    ? 'My orders'
                    : mode === 'sell'
                      ? 'Choose your voucher'
                      : matched.length
                        ? 'Your voucher match'
                        : waiting
                          ? 'Waiting for a match'
                          : 'Your next trade'}
                  {mode === 'sell' && tab === 'market' && (
                    <span className="market-count">{BRANDS.length}</span>
                  )}
                </h2>
                {mode === 'sell' && tab === 'market' ? (
                  <label className="order-search">
                    <Search size={14} />
                    <input
                      placeholder="Search vouchers"
                      aria-label="Search vouchers"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                ) : tab === 'orders' ? (
                  <button
                    className="text-control"
                    onClick={() => setTab('market')}
                  >
                    Back
                    <ArrowRight size={14} />
                  </button>
                ) : (
                  <span className="subtle-label">USDC / INR</span>
                )}
              </div>
              <motion.div
                className="available-content"
                animate={{
                  height: expanded ? 206 : mode === 'sell' ? 466 : 390,
                }}
                transition={{ duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              >
                <div className="available-scroll">
                  {tab === 'orders' && (
                    <div className="live-order-tracking">
                      {!token && (
                        <button
                          className="np-text-link"
                          onClick={async () => {
                            setTrackingError('')
                            try {
                              await signIn()
                            } catch (e) {
                              setTrackingError((e as Error).message)
                            }
                          }}
                        >
                          Sign in to load saved requests
                          <ArrowRight size={13} />
                        </button>
                      )}
                      {(trackingError || mine.error) && (
                        <p className="form-error" role="alert">
                          {trackingError || mine.error}
                        </p>
                      )}
                      {liveMine.map((request) => (
                        <button
                          className="tracked-live-order"
                          key={request.id}
                          onClick={() => {
                            setExternal({
                              key: Date.now(),
                              mode,
                              order: toOrder(request),
                            })
                            setExpanded(true)
                          }}
                        >
                          <span>
                            <strong>
                              {request.brand} · {inr(request.amountInr)}
                            </strong>
                            <small>{request.id}</small>
                          </span>
                          <span className="status-badge">
                            {STATUS[request.status]}
                          </span>
                          <ArrowRight size={14} />
                        </button>
                      ))}
                    </div>
                  )}
                  {tab === 'orders' ? (
                    selectedOrders.length ? (
                      selectedOrders.map((o) => (
                        <div className="saved-order" key={o.id}>
                          <span className={cx('saved-order-icon', o.mode)}>
                            {o.mode === 'buy' ? (
                              <ArrowDownLeft size={17} />
                            ) : (
                              <ArrowUpRight size={17} />
                            )}
                          </span>
                          <div className="saved-order-detail">
                            <strong>
                              {o.mode === 'buy'
                                ? 'Buy USDC'
                                : o.brandName || brand(o.brandId!).name}
                              <span>{o.type}</span>
                            </strong>
                            <span>
                              {inr(o.amount)} · {o.id}
                            </span>
                          </div>
                          <span className={cx('saved-order-status', o.status)}>
                            {o.status === 'open' ? 'Open' : 'Cancelled'}
                          </span>
                          <button
                            className="text-control"
                            onClick={() => {
                              const order = localOrders.find(
                                (x) => x.id === o.id,
                              ) || {
                                id: o.id,
                                brandId: o.brandId || 'voucher',
                                brandName: o.brandName,
                                amount: o.amount,
                                rate: o.limit || 90,
                                seller: o.mode === 'sell' ? 'you' : 'preview',
                                sellerTrades: 0,
                                city: '',
                                postedMin: 0,
                                expiresMin: 30,
                                source: 'preview' as const,
                              }
                              setExternal({ key: Date.now(), mode, order })
                              setExpanded(true)
                            }}
                          >
                            Track
                            <ArrowRight size={13} />
                          </button>
                          {o.status === 'open' && (
                            <button
                              onClick={() => cancelWorkspaceOrder(o.id)}
                              aria-label={`Cancel ${o.id}`}
                            >
                              <X size={15} />
                            </button>
                          )}
                        </div>
                      ))
                    ) : liveMine.length ? null : (
                      <div className="workspace-empty">
                        <span>
                          No{' '}
                          {mode === 'buy' ? 'buy orders' : 'voucher requests'}{' '}
                          yet.
                        </span>
                      </div>
                    )
                  ) : mode === 'sell' ? (
                    <>
                      <div className="voucher-catalog">
                        {filteredBrands.map((b) => (
                          <button
                            key={b.id}
                            className={cx(
                              'voucher-tile',
                              brandId === b.id && 'selected',
                            )}
                            onClick={() => {
                              setBrandId(b.id)
                              setMerchant({
                                merchant_id: b.id,
                                name: b.name,
                                voucher_brand: b.name,
                                category: b.category,
                                site: '',
                              })
                              setExpanded(true)
                              setExternal({
                                key: Date.now(),
                                mode: 'sell',
                                store: {
                                  merchant_id: b.id,
                                  name: b.name,
                                  voucher_brand: b.name,
                                  category: b.category,
                                  site: '',
                                },
                              })
                            }}
                            aria-pressed={brandId === b.id}
                          >
                            <div className="voucher-tile-top">
                              <BrandMark id={b.id} size={31} />
                              {brandId === b.id ? (
                                <Check size={13} />
                              ) : (
                                <ArrowUpRight size={13} />
                              )}
                            </div>
                            <span className="voucher-name">{b.name}</span>
                            <span className="voucher-category">
                              {b.category}
                            </span>
                          </button>
                        ))}
                        {!filteredBrands.length && (
                          <p className="empty-search">No vouchers found.</p>
                        )}
                      </div>
                      <div className="order-book-toolbar">
                        <h3>Buyer orders</h3>
                        <span className="market-count">
                          {filteredIntents.length}
                        </span>
                      </div>
                      <div className="compact-order-head">
                        <span>Voucher</span>
                        <span>Value</span>
                        <span>USDC</span>
                      </div>
                      {filteredIntents.map((o) => (
                        <button
                          key={o.id}
                          className="compact-order-row"
                          onClick={() => {
                            setBrandId(o.brandId)
                            setAmounts((a) => ({
                              ...a,
                              sell: String(o.amount),
                            }))
                            setLimits((l) => ({ ...l, sell: String(o.rate) }))
                          }}
                        >
                          <span>
                            <BrandMark id={o.brandId} size={26} />
                            {brand(o.brandId).name}
                          </span>
                          <span>{inr(o.amount)}</span>
                          <strong>
                            {usdt(quote(o.amount, o.rate).buyerReceives)}
                          </strong>
                        </button>
                      ))}
                    </>
                  ) : matched.length ? (
                    <div className="matched-vouchers">
                      <span className="match-status">
                        <Check size={15} />
                        Preview match found
                      </span>
                      {matched.map((o) => (
                        <div className="matched-voucher" key={o.id}>
                          <BrandMark id={o.brandId} size={40} />
                          <div>
                            <strong>{brand(o.brandId).name}</strong>
                            <span>
                              {inr(o.amount)} voucher ·{' '}
                              {usdt(quote(o.amount, o.rate).buyerReceives)} USDC
                            </span>
                          </div>
                          <Link
                            to={`/market?brand=${o.brandId}`}
                            className="icon-button"
                            aria-label={`View ${brand(o.brandId).name} market`}
                          >
                            <ArrowUpRight size={18} />
                          </Link>
                        </div>
                      ))}
                      <p className="field-hint">
                        Voucher purchase and secure delivery will open once live
                        matching is connected.
                      </p>
                      <button
                        className="np-button secondary"
                        onClick={() => {
                          setMatchedIds([])
                          setWaiting(false)
                        }}
                      >
                        New order
                      </button>
                    </div>
                  ) : (
                    <div className="matching-empty">
                      <div
                        className={cx('matching-orbit', waiting && 'waiting')}
                      >
                        <span />
                        <span />
                        <div>
                          <ArrowDownLeft size={25} />
                        </div>
                      </div>
                      <h3>
                        {waiting
                          ? 'Your order is open'
                          : 'One order. More value.'}
                      </h3>
                      <p>
                        {waiting
                          ? 'Your limit order is waiting for a matching voucher request.'
                          : 'Set your amount and price. The voucher appears after a match.'}
                      </p>
                      <div className="matching-steps">
                        <span>Place order</span>
                        <i />
                        <span>Get matched</span>
                        <i />
                        <span>Buy voucher</span>
                      </div>
                    </div>
                  )}
                </div>
              </motion.div>
              <div className="order-book-footer">
                <span>
                  {mode === 'buy'
                    ? 'No buyer platform fee.'
                    : '1% seller fee. Full voucher value.'}
                </span>
                <span>
                  {source === 'live' ? 'Live requests' : 'Sample orders'}
                </span>
              </div>
            </motion.section>
            {(['buy', 'sell'] as const).map((chatMode) => (
              <TradeAssistant
                key={`${fullAddress || 'anonymous'}:${chatMode}`}
                mode={chatMode}
                active={mode === chatMode}
                expanded={expanded}
                setExpanded={setExpanded}
                orders={[
                  ...localOrders.filter((o) => o.seller === 'you'),
                  ...orders,
                ]}
                source={source}
                rate={types.sell === 'limit' ? Number(limits.sell) || 90 : 90}
                onStore={setStore}
                onDraft={applyDraft}
                onPost={postDraft}
                onSelectRequest={selectRequest}
                onSelectRoute={(order, route) => {
                  setGuideOrder(order)
                  setGuideRoute(route ? { order, route } : null)
                  setAmounts((a) => ({ ...a, buy: String(order.amount) }))
                }}
                localCommand={(text) => localCommand(text, chatMode)}
                external={external?.mode === chatMode ? external : undefined}
              />
            ))}
          </div>
          <aside className="order-ticket" aria-label="Create order">
            <div className="ticket-heading">
              <h2>{mode === 'buy' ? 'Buy USDC' : 'Pay with crypto'}</h2>
              <span className="asset-mark">$</span>
            </div>
            <div
              className="order-type-switch"
              role="group"
              aria-label="Order type"
            >
              {(['market', 'limit'] as const).map((t) => (
                <button
                  key={t}
                  aria-pressed={orderType === t}
                  onClick={() => setTypes((all) => ({ ...all, [mode]: t }))}
                >
                  {orderType === t && (
                    <motion.span layoutId="order-type" transition={spring} />
                  )}
                  <span>{t === 'market' ? 'Market' : 'Limit'}</span>
                </button>
              ))}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault()
                if (validAmount && validLimit) setReview(true)
              }}
            >
              {mode === 'sell' && (
                <label className="ticket-voucher-label">
                  Voucher
                  <div className="ticket-voucher">
                    <BrandMark id={brandId} size={26} />
                    <select
                      aria-label="Voucher brand"
                      value={brandId}
                      onChange={(e) => setBrandId(e.target.value)}
                    >
                      {(merchant &&
                      !BRANDS.some((b) => b.id === merchant.merchant_id)
                        ? [
                            ...BRANDS,
                            { id: merchant.merchant_id, name: merchant.name },
                          ]
                        : BRANDS
                      ).map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={14} />
                  </div>
                </label>
              )}
              <label htmlFor="trade-amount" className="ticket-amount-label">
                {mode === 'buy' ? 'You spend' : 'Voucher value'}
              </label>
              <div className="ticket-amount">
                <span>₹</span>
                <input
                  id="trade-amount"
                  type="number"
                  min={100}
                  max={200000}
                  step="0.01"
                  inputMode="decimal"
                  required
                  value={amounts[mode]}
                  onChange={(e) =>
                    setAmounts((a) => ({ ...a, [mode]: e.target.value }))
                  }
                />
                <span className="currency-unit">INR</span>
              </div>
              <div className="amount-presets">
                {[5000, 10000, 25000].map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={amount === p ? 'selected' : ''}
                    onClick={() =>
                      setAmounts((a) => ({ ...a, [mode]: String(p) }))
                    }
                  >
                    {inr(p)}
                  </button>
                ))}
              </div>
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={orderType}
                  initial={{ opacity: 0, height: 0 }}
                  animate={{ opacity: 1, height: 'auto' }}
                  exit={{ opacity: 0, height: 0 }}
                  transition={{ duration: 0.22 }}
                  className="order-condition"
                >
                  {orderType === 'market' ? (
                    <div className="slippage-control">
                      <div className="slippage-heading">
                        <label htmlFor="slippage-tolerance">
                          Slippage tolerance
                        </label>
                        <strong>{slippage}%</strong>
                      </div>
                      <input
                        id="slippage-tolerance"
                        type="range"
                        min={1}
                        max={8}
                        value={slippage}
                        onChange={(e) => setSlippage(Number(e.target.value))}
                      />
                      <div className="slippage-ends">
                        <span>1%</span>
                        <span>8%</span>
                      </div>
                    </div>
                  ) : (
                    <div className="limit-field">
                      <label htmlFor="limit-rate">
                        {mode === 'buy' ? 'Maximum price' : 'Minimum rate'}
                      </label>
                      <div>
                        <span>₹</span>
                        <input
                          id="limit-rate"
                          type="number"
                          min={1}
                          max={1000}
                          step="0.01"
                          value={limits[mode]}
                          onChange={(e) =>
                            setLimits((l) => ({ ...l, [mode]: e.target.value }))
                          }
                          required
                        />
                        <span>/ USDC</span>
                      </div>
                    </div>
                  )}
                </motion.div>
              </AnimatePresence>
              <div className="ticket-divider">
                <span>
                  <ArrowDownLeft size={12} />
                </span>
              </div>
              <div className="ticket-receive-label">
                {mode === 'buy' ? 'Estimated receive' : 'You receive'}
              </div>
              <div className="ticket-receive">
                {mode === 'buy'
                  ? usdt(buy.receive)
                  : inr(validAmount ? amount : 0)}
                <span>{mode === 'buy' ? 'USDC' : 'voucher'}</span>
              </div>
              <div className="ticket-summary">
                {mode === 'buy' ? (
                  <>
                    <div>
                      <span>Platform fee</span>
                      <strong>0%</strong>
                    </div>
                    {buy.remainder > 0 && (
                      <div>
                        <span>Unallocated</span>
                        <strong>{inr(buy.remainder)}</strong>
                      </div>
                    )}
                  </>
                ) : (
                  <>
                    <div>
                      <span>USDC</span>
                      <strong>{usdt(sell.buyerReceives)}</strong>
                    </div>
                    <div>
                      <span>Seller fee · 1%</span>
                      <strong>{usdt(sell.fee)}</strong>
                    </div>
                    <div className="ticket-total">
                      <span>Total USDC</span>
                      <strong>{usdt(sell.sellerLocks)}</strong>
                    </div>
                  </>
                )}
              </div>
              <RateCalculator
                amount={mode === 'buy' ? buy.spend : validAmount ? amount : 0}
                receive={buy.receive}
                seller={mode === 'sell'}
                rate={sellRate}
                serviceEstimate={
                  mode === 'buy' &&
                  guideRoute &&
                  buy.spend === guideRoute.order.amount &&
                  buy.fills.some((o) => o.id === guideRoute.order.id)
                    ? {
                        label: guideRoute.route.card,
                        channel: guideRoute.route.channel,
                        rewardInr: guideRoute.route.expected_value_rupees,
                        checkedOn: guideRoute.route.checked_on,
                      }
                    : undefined
                }
                clearServiceEstimate={() => setGuideRoute(null)}
              />
              <button
                type="submit"
                className="ticket-submit"
                disabled={!canSubmit}
              >
                {mode === 'buy' ? 'Review order' : 'Review request'}
                <ArrowRight size={17} />
              </button>
              <div className="ticket-footnote">
                {mode === 'buy' &&
                orderType === 'market' &&
                validAmount &&
                !buy.fills.length
                  ? 'No market match. Adjust the amount or use Limit.'
                  : 'Preview only · no funds move'}
              </div>
            </form>
            <Link to="/cards" className="ticket-cards-link">
              <span>
                <CreditCard size={15} />
                My cards
              </span>
              <ArrowUpRight size={14} />
            </Link>
          </aside>
        </div>
      </div>
      {review && (
        <Dialog
          title={mode === 'buy' ? 'Review buy order' : 'Review voucher request'}
          close={() => setReview(false)}
        >
          <div className="review-amount">
            {inr(amount)}
            <span>
              {mode === 'buy'
                ? 'buying budget'
                : `${merchant?.merchant_id === brandId ? merchant.voucher_brand || merchant.name : brand(brandId).name} voucher`}
            </span>
          </div>
          <div className="review-lines">
            <div>
              <span>Order type</span>
              <strong>{orderType === 'market' ? 'Market' : 'Limit'}</strong>
            </div>
            <div>
              <span>{orderType === 'market' ? 'Slippage' : 'Limit rate'}</span>
              <strong>
                {orderType === 'market'
                  ? `${slippage}%`
                  : `${inr(limit, 2)} / USDC`}
              </strong>
            </div>
            <div>
              <span>
                {mode === 'buy' ? 'Estimated USDC' : 'Total USDC including fee'}
              </span>
              <strong>
                {usdt(mode === 'buy' ? buy.receive : sell.sellerLocks)}
              </strong>
            </div>
          </div>
          <p className="review-note">
            {mode === 'buy' && buy.remainder > 0
              ? `${inr(buy.remainder)} remains unallocated. Whole vouchers only. `
              : ''}
            This saves a preview order for this session. No payment or escrow
            transaction occurs.
          </p>
          <button
            className="ticket-submit"
            disabled={!canSubmit}
            onClick={submit}
          >
            {!address ? 'Connect wallet' : 'Save preview order'}
            <ArrowRight size={16} />
          </button>
        </Dialog>
      )}
    </div>
  )
}
