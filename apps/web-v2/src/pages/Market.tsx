import { AnimatePresence, motion } from 'motion/react'
import { ArrowUpRight, Search, SlidersHorizontal } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { BrandMark, cx } from '../components/ui'
import { BRANDS, brand } from '../lib/data'
import { effectivePrice, inr, quote, routesFor, usdt } from '../lib/engine'
import { useApp } from '../lib/store'
import { useOrderBook } from '../lib/orderbook'
const CATEGORIES = ['All', ...new Set(BRANDS.map((b) => b.category))]
export default function Market() {
  const { cards } = useApp()
  const { orders, source } = useOrderBook()
  const [params] = useSearchParams()
  const [search, setSearch] = useState(
    params.get('brand') ? brand(params.get('brand')!).name : '',
  )
  const [category, setCategory] = useState('All')
  const [sort, setSort] = useState('rate')
  const rows = useMemo(
    () =>
      orders
        .filter(
          (o) =>
            o.expiresMin > 0 &&
            (category === 'All' || brand(o.brandId).category === category) &&
            (brand(o.brandId).name + o.seller)
              .toLowerCase()
              .includes(search.toLowerCase()),
        )
        .map((o) => {
          const q = quote(o.amount, o.rate),
            best = routesFor(o.amount, cards)[0]
          return {
            ...o,
            receive: q.buyerReceives,
            best,
            effective: best
              ? effectivePrice(o.amount, best.statementInr, q.buyerReceives)
              : o.rate,
          }
        })
        .sort((a, b) =>
          sort === 'rate'
            ? a.effective - b.effective
            : sort === 'value'
              ? b.amount - a.amount
              : a.postedMin - b.postedMin,
        ),
    [orders, cards, category, search, sort],
  )
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Marketplace</span>
          <h1>Find your next match.</h1>
          <p>Voucher requests, ranked by your estimated cash-value rate.</p>
        </div>
        <span className="status-badge">
          {source === 'live' ? 'Live order book' : 'Sample order book'}
        </span>
      </div>
      <div className="market-controls">
        <label className="np-search">
          <Search size={17} />
          <input
            aria-label="Search market"
            placeholder="Search vouchers or sellers"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </label>
        <label className="np-select">
          <SlidersHorizontal size={15} />
          <select
            aria-label="Sort orders"
            value={sort}
            onChange={(e) => setSort(e.target.value)}
          >
            <option value="rate">Best effective rate</option>
            <option value="value">Largest amount</option>
            <option value="new">Newest</option>
          </select>
        </label>
      </div>
      <div
        className="category-tabs"
        role="group"
        aria-label="Voucher categories"
      >
        {CATEGORIES.map((c) => (
          <button
            key={c}
            onClick={() => setCategory(c)}
            className={cx(category === c && 'active')}
          >
            {c}
          </button>
        ))}
      </div>
      <section className="np-panel market-list">
        <div className="market-list-head">
          <span>Voucher</span>
          <span>Value</span>
          <span>You receive</span>
          <span>Net rate</span>
          <span />
        </div>
        <AnimatePresence initial={false}>
          {rows.map((o) => (
            <motion.div
              layout
              key={o.id}
              className="market-list-row"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.22 }}
            >
              <div className="market-brand">
                <BrandMark id={o.brandId} size={38} />
                <div>
                  <strong>{brand(o.brandId).name}</strong>
                  <small>{o.seller}</small>
                </div>
              </div>
              <span>{inr(o.amount)}</span>
              <span>
                {usdt(o.receive)} <small>USDC</small>
              </span>
              <div>
                <strong>{inr(o.effective, 2)}</strong>
                <small>
                  {o.best
                    ? `${o.best.cardLabel} · ${o.best.channel.name}`
                    : 'No rewards selected'}
                </small>
              </div>
              <Link
                to={`/home?request=${encodeURIComponent(o.id)}`}
                className="icon-button"
                aria-label={`Review ${brand(o.brandId).name} ${inr(o.amount)} order`}
              >
                <ArrowUpRight size={18} />
              </Link>
            </motion.div>
          ))}
        </AnimatePresence>
        {!rows.length && (
          <div className="empty-state">
            <Search size={24} />
            <h3>No matching requests</h3>
            <p>Try another voucher or category.</p>
            <button
              className="np-button secondary"
              onClick={() => {
                setSearch('')
                setCategory('All')
              }}
            >
              Reset filters
            </button>
          </div>
        )}
      </section>
      <p className="field-hint">
        Rewards use illustrative card rates and statement-credit values. Compare
        live issuer terms before buying.
      </p>
    </div>
  )
}
