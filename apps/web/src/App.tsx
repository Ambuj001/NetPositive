import { useState } from 'react'
import type { FormEvent } from 'react'
import {
  ArrowUpRight,
  ArrowRight,
  ArrowDown,
  Check,
  ChevronDown,
  Copy,
  ExternalLink,
  Globe2,
  Menu,
  Plus,
  Wallet,
  X,
  CreditCard,
  CheckCheck,
  Clock3,
  Search,
} from 'lucide-react'
import { Dialog } from './components/Dialog'
import { ARC, useWallet } from './lib/wallet'
import { RESEARCH_SOURCE, rewardRoutes, voucherPreview } from './lib/rewards'

type Mode = 'buy' | 'sell'
type Voucher = {
  id: string
  name: string
  category: string
  amount: number
  color: string
  mark: string
  caption: string
}
type Draft = {
  id: string
  mode: Mode
  brand: string
  amount: number
  created: string
}
const vouchers: Voucher[] = [
  {
    id: 'lifestyle',
    name: 'Lifestyle',
    category: 'Shopping',
    amount: 5000,
    color: 'sage',
    mark: 'lifestyle',
    caption: 'A little wardrobe refresh.',
  },
  {
    id: 'amazon',
    name: 'Amazon Shopping',
    category: 'Shopping',
    amount: 2500,
    color: 'peach',
    mark: 'a',
    caption: 'For the things on your list.',
  },
  {
    id: 'swiggy',
    name: 'Swiggy',
    category: 'Food & rides',
    amount: 1000,
    color: 'lavender',
    mark: 'S',
    caption: 'Good food. Good company.',
  },
  {
    id: 'makemytrip',
    name: 'MakeMyTrip',
    category: 'Travel',
    amount: 10000,
    color: 'blue',
    mark: 'make\nmytrip',
    caption: 'Your next change of scenery.',
  },
]
const categories = ['All vouchers', 'Shopping', 'Food & rides', 'Travel']
const inr = (n: number) =>
  new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency: 'INR',
    maximumFractionDigits: 0,
  }).format(n)
const number = (n: number) =>
  new Intl.NumberFormat('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
const github = 'https://github.com/Ambuj001/NetPositive'
function Mark({ className = '' }: { className?: string }) {
  return (
    <svg
      className={`brand-mark ${className}`}
      viewBox="0 0 40 32"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M4 26V6h5l17 20h5V6"
        stroke="currentColor"
        strokeWidth="3.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M23 6h13M31 1v10"
        stroke="currentColor"
        strokeWidth="2.8"
        strokeLinecap="round"
      />
    </svg>
  )
}
function UsdcIcon() {
  return (
    <span className="usdc-icon" aria-hidden="true">
      $
    </span>
  )
}
function getDrafts(): Draft[] {
  try {
    const value: unknown = JSON.parse(
      localStorage.getItem('netpositive:drafts:v1') || '[]',
    )
    if (!Array.isArray(value)) return []
    return value
      .filter(
        (d): d is Draft =>
          d &&
          typeof d.id === 'string' &&
          (d.mode === 'buy' || d.mode === 'sell') &&
          typeof d.brand === 'string' &&
          Number.isFinite(d.amount) &&
          d.amount >= 250 &&
          d.amount <= 50000 &&
          typeof d.created === 'string',
      )
      .slice(0, 20)
  } catch {
    return []
  }
}

export default function App() {
  const wallet = useWallet()
  const [menu, setMenu] = useState(false)
  const [category, setCategory] = useState('All vouchers')
  const [search, setSearch] = useState('')
  const [modal, setModal] = useState<
    'trade' | 'wallet' | 'privacy' | 'drafts' | null
  >(null)
  const [mode, setMode] = useState<Mode>('buy')
  const [voucher, setVoucher] = useState(vouchers[0])
  const [amount, setAmount] = useState('5000')
  const [review, setReview] = useState(false)
  const [saved, setSaved] = useState(false)
  const [storageError, setStorageError] = useState('')
  const [drafts, setDrafts] = useState<Draft[]>(getDrafts)
  const [copied, setCopied] = useState(false)
  const [hasBonus, setHasBonus] = useState(true)
  const [routeType, setRouteType] = useState<'all' | 'direct'>('all')
  const routes = rewardRoutes(5000, hasBonus).filter(
    (r) => routeType === 'all' || r.id === 'direct',
  )
  const filtered = vouchers.filter(
    (v) =>
      (category === 'All vouchers' || v.category === category) &&
      v.name.toLowerCase().includes(search.toLowerCase()),
  )
  const validAmount =
    Number.isFinite(Number(amount)) &&
    Number(amount) >= 250 &&
    Number(amount) <= 50000
  const quote = validAmount ? voucherPreview(Number(amount), mode) : null
  function openTrade(nextMode: Mode, nextVoucher = vouchers[0]) {
    setMode(nextMode)
    setVoucher(nextVoucher)
    setAmount(String(nextVoucher.amount))
    setReview(false)
    setSaved(false)
    setStorageError('')
    setModal('trade')
    setMenu(false)
  }
  function saveDraft() {
    const next = [
      {
        id: crypto.randomUUID(),
        mode,
        brand: voucher.name,
        amount: Number(amount),
        created: new Date().toISOString(),
      },
      ...drafts,
    ].slice(0, 20)
    try {
      localStorage.setItem('netpositive:drafts:v1', JSON.stringify(next))
      setDrafts(next)
      setSaved(true)
    } catch {
      setStorageError(
        'Your browser couldn’t save this draft. Please allow local storage and try again.',
      )
    }
  }
  function clearDrafts() {
    try {
      localStorage.removeItem('netpositive:drafts:v1')
      setDrafts([])
      setStorageError('')
    } catch {
      setStorageError(
        'Your browser couldn’t clear these drafts. Please try again.',
      )
    }
  }
  function navigate() {
    setMenu(false)
  }
  return (
    <>
      <a className="skip-link" href="#main">
        Skip to content
      </a>
      <header className="header">
        <a className="brand" href="#" aria-label="NetPositive home">
          <Mark />
          NetPositive
        </a>
        <nav
          className={`navigation ${menu ? 'navigation-open' : ''}`}
          aria-label="Main navigation"
        >
          <a href="#explore" onClick={navigate}>
            Explore vouchers
          </a>
          <a href="#how-it-works" onClick={navigate}>
            How it works
          </a>
          <a href="#rewards" onClick={navigate}>
            Rewards
          </a>
          <a href="#faq" onClick={navigate}>
            FAQs
          </a>
        </nav>
        <div className="header-actions">
          <button
            className="icon-button drafts-button"
            aria-label={`View drafts${drafts.length ? `, ${drafts.length} saved` : ''}`}
            onClick={() => {
              setStorageError('')
              setModal('drafts')
            }}
          >
            <Clock3 size={19} />
            {drafts.length > 0 && (
              <span className="draft-count">{drafts.length}</span>
            )}
          </button>
          <button
            className="button button-dark wallet-button"
            onClick={() => setModal('wallet')}
          >
            <span>
              {wallet.address
                ? `${wallet.address.slice(0, 6)}…${wallet.address.slice(-4)}`
                : 'Connect wallet'}
            </span>
            <Wallet size={16} />
          </button>
          <button
            className="icon-button menu-button"
            aria-label={menu ? 'Close navigation' : 'Open navigation'}
            aria-expanded={menu}
            onClick={() => setMenu(!menu)}
          >
            {menu ? <X /> : <Menu />}
          </button>
        </div>
      </header>

      <main id="main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="eyebrow hero-eyebrow">
            <span className="tiny-plus">+</span> A LITTLE MORE ON YOUR SIDE
          </div>
          <h1 id="hero-title">
            Good value.
            <br />
            <span>Goes both ways.</span>
          </h1>
          <p className="hero-description">
            Vouchers meet crypto.
            <br className="mobile-break" /> You meet your next good deal.
          </p>
          <div className="orbit-stage">
            <button
              className="orbit orbit-buy"
              aria-label="Buy voucher"
              onClick={() => openTrade('buy')}
            >
              <span className="orbit-content">
                <span className="orbit-kicker">
                  SOMETHING TO LOOK FORWARD TO
                </span>
                <span className="orbit-action">
                  Buy voucher <ArrowUpRight size={23} />
                </span>
                <span className="orbit-caption">
                  Pay with USDC. Make it yours.
                </span>
              </span>
              <span className="orbit-coordinate" aria-hidden="true">
                01 / BUY
              </span>
            </button>
            <button
              className="orbit orbit-sell"
              aria-label="Sell voucher"
              onClick={() => openTrade('sell')}
            >
              <span className="orbit-content">
                <span className="orbit-kicker">A LITTLE VALUE TO UNLOCK</span>
                <span className="orbit-action">
                  Sell voucher <ArrowUpRight size={23} />
                </span>
                <span className="orbit-caption">
                  Your voucher. A new possibility.
                </span>
              </span>
              <span className="orbit-coordinate" aria-hidden="true">
                02 / SELL
              </span>
            </button>
            <span className="orbit-meeting" aria-hidden="true">
              <Plus size={24} strokeWidth={1.5} />
            </span>
          </div>
          <div className="hero-bottom">
            <span>ONE GOOD EXCHANGE. TWO HAPPY SIDES.</span>
            <a href="#explore" aria-label="Explore the voucher collection">
              <ArrowDown size={18} />
            </a>
            <span>DESIGNED FOR EVERYDAY VALUE.</span>
          </div>
        </section>

        <section
          className="ecosystem wrap"
          aria-label="Network and settlement asset"
        >
          <span>
            New possibilities.
            <br />
            Familiar foundations.
          </span>
          <div>
            <a
              href="https://www.arc.io/"
              target="_blank"
              rel="noreferrer"
              className="arc-wordmark"
            >
              ◜ Arc
            </a>
            <span className="ecosystem-divider" />
            <a
              href="https://www.circle.com/usdc"
              target="_blank"
              rel="noreferrer"
              className="usdc-wordmark"
            >
              <UsdcIcon /> USDC
            </a>
          </div>
          <span className="ecosystem-label">BUILDING ON ARC</span>
        </section>

        <section
          className="explore section wrap"
          id="explore"
          aria-labelledby="explore-title"
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">THE COLLECTION</span>
              <h2 id="explore-title">A good place to start.</h2>
            </div>
            <p>
              Everyday essentials.
              <br />
              Something just for you.
            </p>
          </div>
          <div className="collection-toolbar">
            <div className="filters" role="group" aria-label="Filter vouchers">
              {categories.map((c) => (
                <button
                  key={c}
                  className={category === c ? 'active' : ''}
                  onClick={() => setCategory(c)}
                  aria-pressed={category === c}
                >
                  {c}
                </button>
              ))}
            </div>
            <label className="search-box">
              <Search size={17} />
              <input
                type="search"
                aria-label="Search vouchers"
                placeholder="Find a brand"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </label>
          </div>
          <div className="voucher-grid">
            {filtered.map((v) => (
              <button
                className="voucher-card"
                key={v.id}
                onClick={() => openTrade('buy', v)}
                aria-label={`Preview ${v.name} voucher`}
              >
                <span className={`voucher-art ${v.color}`}>
                  <span className={`voucher-wordmark mark-${v.id}`}>
                    {v.mark}
                  </span>
                  <span className="voucher-art-bottom">
                    <span>GIFT SOMETHING GOOD</span>
                    <span className="voucher-art-symbol">
                      <ArrowUpRight size={17} />
                    </span>
                  </span>
                </span>
                <span className="voucher-info">
                  <span>
                    <strong>{v.name}</strong>
                    <span className="voucher-caption">{v.caption}</span>
                  </span>
                  <ArrowUpRight size={19} />
                </span>
              </button>
            ))}
          </div>
          {!filtered.length && (
            <div className="empty-state">
              <Search size={24} />
              <h3>No matches. More possibilities.</h3>
              <p>Try another brand or explore all vouchers.</p>
              <button
                className="text-button"
                onClick={() => {
                  setSearch('')
                  setCategory('All vouchers')
                }}
              >
                Clear filters <ArrowRight size={16} />
              </button>
            </div>
          )}
          <div className="collection-bottom">
            <span>Preview collection</span>
            <button className="text-button" onClick={() => openTrade('sell')}>
              Have a voucher? <span>Make it a possibility</span>{' '}
              <ArrowUpRight size={16} />
            </button>
          </div>
        </section>

        <section
          className="how-section section"
          id="how-it-works"
          aria-labelledby="how-title"
        >
          <div className="wrap">
            <div className="section-heading">
              <div>
                <span className="eyebrow">
                  LESS FRICTION. MORE POSSIBILITY.
                </span>
                <h2 id="how-title">
                  A simple exchange.
                  <br />A better everyday.
                </h2>
              </div>
              <a
                href="#explore"
                className="round-link"
                aria-label="Find a voucher"
              >
                <ArrowUpRight size={24} />
              </a>
            </div>
            <div className="steps">
              {[
                [
                  '01',
                  'Find your side.',
                  'Choose a voucher you’ll love. Or bring one you’re ready to let go of.',
                ],
                [
                  '02',
                  'Make the connection.',
                  'Connect your wallet and see the details of your exchange.',
                ],
                [
                  '03',
                  'Keep the upside.',
                  'More value for your next purchase. More possibilities for what comes after.',
                ],
              ].map(([n, title, body]) => (
                <article key={n}>
                  <span className="step-number">
                    {n}
                    <span />
                  </span>
                  <h3>{title}</h3>
                  <p>{body}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section
          className="rewards-section section wrap"
          id="rewards"
          aria-labelledby="rewards-title"
        >
          <div className="rewards-copy">
            <span className="eyebrow">THE EXTRA IN EVERYDAY</span>
            <h2 id="rewards-title">
              Your cards.
              <br />
              Their full potential.
            </h2>
            <p>
              The right card. The right route. We help you find the value you
              might otherwise leave behind.
            </p>
            <a
              className="text-button"
              href={
                github + '/blob/frontend/data/research/2026-11-05/README.md'
              }
              target="_blank"
              rel="noreferrer"
            >
              Explore the research <ArrowUpRight size={17} />
            </a>
          </div>
          <div className="reward-demo">
            <div className="demo-heading">
              <div className="mini-mark">
                <Mark />
              </div>
              <span>Your next little win.</span>
              <span className="example-tag">Example</span>
            </div>
            <div className="demo-purchase">
              <span>Lifestyle</span>
              <strong>
                ₹5,000<span>.00</span>
              </strong>
              <span>HDFC Infinia</span>
            </div>
            <div className="demo-controls">
              <button
                aria-pressed={routeType === 'all'}
                onClick={() => setRouteType('all')}
                className={routeType === 'all' ? 'selected' : ''}
              >
                All routes
              </button>
              <button
                aria-pressed={routeType === 'direct'}
                onClick={() => setRouteType('direct')}
                className={routeType === 'direct' ? 'selected' : ''}
              >
                Direct only
              </button>
            </div>
            <div className="reward-routes" aria-live="polite">
              {routes.map((r, i) => (
                <div
                  className={i === 0 ? 'reward-route winner' : 'reward-route'}
                  key={r.id}
                >
                  <span className="route-selector">
                    {i === 0 && <Check size={12} />}
                  </span>
                  <span>
                    <strong>{r.name}</strong>
                    <small>{r.detail}</small>
                  </span>
                  <span className="route-value">
                    {inr(r.value)}
                    {i === 0 && <small>BEST VALUE</small>}
                  </span>
                </div>
              ))}
            </div>
            <div className="demo-cap">
              <span>Voucher bonus available</span>
              <button
                className={`switch ${hasBonus ? 'switch-on' : ''}`}
                role="switch"
                aria-checked={hasBonus}
                aria-label="Voucher bonus available"
                onClick={() => setHasBonus(!hasBonus)}
              >
                <span />
              </button>
            </div>
            <p className="demo-note">
              Illustrative travel value at ₹1/point.{' '}
              <a href={RESEARCH_SOURCE} target="_blank" rel="noreferrer">
                Terms & caps <ArrowUpRight size={10} />
              </a>
            </p>
          </div>
        </section>

        <section className="principle-section wrap">
          <div className="principle-top">
            <span className="eyebrow">A POSITIVE CHANGE</span>
            <span>BY DESIGN.</span>
          </div>
          <h2>
            Less left behind.
            <br />
            <span>More to look forward to.</span>
          </h2>
          <div className="principle-bottom">
            <p>
              Built around the idea that an exchange
              <br />
              should feel good on both sides.
            </p>
            <button
              className="button button-lime"
              onClick={() => openTrade('buy')}
            >
              Find your next voucher <ArrowUpRight size={18} />
            </button>
          </div>
          <div className="principle-orbits" aria-hidden="true">
            <span />
            <span />
          </div>
        </section>

        <section
          className="faq-section section wrap"
          id="faq"
          aria-labelledby="faq-title"
        >
          <div>
            <span className="eyebrow">A LITTLE CLARITY</span>
            <h2 id="faq-title">Good questions.</h2>
            <p>The details make the difference.</p>
          </div>
          <div className="faq-list">
            {[
              [
                'What is NetPositive?',
                'A place to explore voucher exchanges with USDC, and discover better ways to use the cards you already have. We’re bringing everyday spending and crypto a little closer together.',
              ],
              [
                'How do buying and selling work?',
                'Choose a brand and voucher value to preview either side of the exchange. Buying a voucher means paying with USDC. Selling a voucher means receiving USDC.',
              ],
              [
                'Can I keep my card rewards?',
                'Our intended model lets the cardholder keep eligible issuer rewards. The actual return depends on the card, purchase route, merchant terms and remaining caps. The research example above shows why the route matters.',
              ],
              [
                'Which network does NetPositive use?',
                'We’re building on Arc, the network from Circle, with USDC. Wallet connection in this preview uses Arc Testnet. Testnet USDC has no cash value.',
              ],
              [
                'Can I trade real vouchers here yet?',
                'Not yet. This is our frontend preview. You can explore vouchers, compare an illustrative reward example, connect a browser wallet, and save drafts. No vouchers are issued, no orders are published, and no funds move.',
              ],
            ].map(([q, a]) => (
              <details key={q}>
                <summary>
                  {q}
                  <Plus size={18} />
                </summary>
                <p>{a}</p>
              </details>
            ))}
          </div>
        </section>
      </main>

      <footer className="footer wrap">
        <div className="footer-top">
          <a className="brand" href="#">
            <Mark />
            NetPositive
          </a>
          <p>
            A positive exchange.
            <br />
            For everyone in it.
          </p>
          <div>
            <a href="#explore">Explore</a>
            <a href="#how-it-works">How it works</a>
            <a href="#rewards">Rewards</a>
          </div>
          <div>
            <a href={github} target="_blank" rel="noreferrer">
              GitHub <ArrowUpRight size={12} />
            </a>
            <a href="https://docs.arc.io/" target="_blank" rel="noreferrer">
              Arc docs <ArrowUpRight size={12} />
            </a>
            <button onClick={() => setModal('privacy')}>Privacy</button>
          </div>
        </div>
        <div className="footer-bottom">
          <span>© {new Date().getFullYear()} NetPositive</span>
          <span>
            <span className="status-dot" /> ARC TESTNET
          </span>
          <span>MORE GOOD. LESS FRICTION.</span>
        </div>
      </footer>

      {modal === 'wallet' && (
        <Dialog
          title={wallet.address ? 'Your wallet.' : 'Your wallet. Your move.'}
          close={() => setModal(null)}
        >
          <p className="dialog-subtitle">
            Connect to your side of the exchange.
          </p>
          {wallet.address ? (
            <>
              <div className="wallet-account">
                <span className="wallet-avatar">
                  <Wallet size={25} />
                </span>
                <strong>
                  {wallet.address.slice(0, 6)}…{wallet.address.slice(-4)}
                </strong>
                <span className="network-pill">
                  <span className="status-dot" />
                  {wallet.onArc ? 'Arc Testnet' : 'Switch network'}
                </span>
              </div>
              <div className="wallet-tools">
                <button
                  className="button button-soft"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(wallet.address)
                      setCopied(true)
                      setTimeout(() => setCopied(false), 2000)
                    } catch {
                      setCopied(false)
                    }
                  }}
                >
                  {copied ? <CheckCheck size={16} /> : <Copy size={16} />}{' '}
                  {copied ? 'Copied' : 'Copy address'}
                </button>
                {wallet.onArc && (
                  <a
                    className="button button-soft"
                    href={`${ARC.blockExplorerUrls[0]}/address/${wallet.address}`}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Explorer <ExternalLink size={15} />
                  </a>
                )}
              </div>
              {!wallet.onArc && (
                <button
                  className="button button-dark full-width"
                  disabled={wallet.busy}
                  onClick={wallet.switchNetwork}
                >
                  {wallet.busy ? 'Check your wallet…' : 'Switch to Arc Testnet'}
                  <ArrowRight size={17} />
                </button>
              )}
              <button
                className="text-button disconnect"
                onClick={wallet.disconnect}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <div className="wallet-options">
                {wallet.wallets.length ? (
                  wallet.wallets.map((w) => (
                    <button
                      key={w.info.uuid}
                      onClick={() => wallet.connect(w)}
                      disabled={wallet.busy}
                    >
                      <span className="wallet-option-icon">
                        <Wallet size={20} />
                      </span>
                      <span>
                        {wallet.busy ? 'Check your wallet…' : w.info.name}
                      </span>
                      <ArrowUpRight size={18} />
                    </button>
                  ))
                ) : (
                  <div className="wallet-empty">
                    <span className="wallet-option-icon">
                      <Wallet size={25} />
                    </span>
                    <h3>Bring your browser wallet.</h3>
                    <p>
                      Open NetPositive in a wallet-enabled browser, or install a
                      wallet to connect.
                    </p>
                    <a
                      className="button button-dark"
                      href="https://metamask.io/download/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Get MetaMask <ArrowUpRight size={16} />
                    </a>
                  </div>
                )}
              </div>
              <span className="wallet-network">
                <Globe2 size={14} /> Arc Testnet
              </span>
            </>
          )}
          {wallet.error && (
            <p className="form-error" role="alert">
              {wallet.error}
            </p>
          )}
        </Dialog>
      )}

      {modal === 'trade' && (
        <Dialog
          title={
            saved
              ? 'A good start.'
              : review
                ? 'Your exchange, at a glance.'
                : mode === 'buy'
                  ? 'Find your next good thing.'
                  : 'Give your voucher a next.'
          }
          close={() => setModal(null)}
          className="trade-dialog"
        >
          {saved ? (
            <div className="saved-state">
              <span className="saved-icon">
                <Check size={28} />
              </span>
              <h3>Draft saved.</h3>
              <p>
                You’ll find it in your drafts. Pick up right where you left off.
              </p>
              <button
                className="button button-dark full-width"
                onClick={() => setModal('drafts')}
              >
                View drafts <ArrowRight size={17} />
              </button>
            </div>
          ) : (
            <>
              <div
                className="trade-tabs"
                role="group"
                aria-label="Exchange side"
              >
                <button
                  className={mode === 'buy' ? 'active' : ''}
                  aria-pressed={mode === 'buy'}
                  onClick={() => {
                    setMode('buy')
                    setReview(false)
                  }}
                >
                  Buy voucher
                </button>
                <button
                  className={mode === 'sell' ? 'active' : ''}
                  aria-pressed={mode === 'sell'}
                  onClick={() => {
                    setMode('sell')
                    setReview(false)
                  }}
                >
                  Sell voucher
                </button>
              </div>
              {review && quote ? (
                <div className="quote-review">
                  <span className={`quote-brand ${voucher.color}`}>
                    {voucher.mark}
                  </span>
                  <h3>{voucher.name}</h3>
                  <strong className="quote-amount">
                    {inr(Number(amount))}
                  </strong>
                  <dl>
                    <div>
                      <dt>
                        {mode === 'buy'
                          ? 'Voucher value in USDC'
                          : 'You receive'}
                      </dt>
                      <dd>{number(quote.principal)} USDC</dd>
                    </div>
                    <div>
                      <dt>Platform fee</dt>
                      <dd>{number(quote.fee)} USDC</dd>
                    </div>
                    {mode === 'buy' && (
                      <div className="quote-total">
                        <dt>Total</dt>
                        <dd>{number(quote.total)} USDC</dd>
                      </div>
                    )}
                  </dl>
                  <p className="quote-note">
                    Example at ₹90/USDC. No funds move.
                  </p>
                  <button
                    className="button button-dark full-width"
                    onClick={saveDraft}
                  >
                    Save draft <ArrowRight size={17} />
                  </button>
                  <button
                    className="text-button edit-preview"
                    onClick={() => setReview(false)}
                  >
                    Edit details
                  </button>
                </div>
              ) : (
                <form
                  onSubmit={(e: FormEvent) => {
                    e.preventDefault()
                    if (validAmount) setReview(true)
                  }}
                >
                  <label className="form-label" htmlFor="brand">
                    Brand
                  </label>
                  <div className="select-wrap">
                    <select
                      id="brand"
                      value={voucher.id}
                      onChange={(e) =>
                        setVoucher(
                          vouchers.find((v) => v.id === e.target.value)!,
                        )
                      }
                    >
                      {vouchers.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                    <ChevronDown size={17} />
                  </div>
                  <label className="form-label" htmlFor="amount">
                    Voucher value
                  </label>
                  <div className="amount-input">
                    <span>₹</span>
                    <input
                      id="amount"
                      type="number"
                      min="250"
                      max="50000"
                      step="1"
                      value={amount}
                      onChange={(e) => setAmount(e.target.value)}
                      required
                      aria-describedby="amount-help"
                    />
                    <span>INR</span>
                  </div>
                  <div className="amount-presets">
                    {[1000, 2500, 5000, 10000].map((n) => (
                      <button
                        key={n}
                        type="button"
                        onClick={() => setAmount(String(n))}
                        className={Number(amount) === n ? 'selected' : ''}
                      >
                        {inr(n)}
                      </button>
                    ))}
                  </div>
                  <p className="field-note" id="amount-help">
                    India · Preview values from ₹250 to ₹50,000
                  </p>
                  <div className="trade-receive">
                    <span>{mode === 'buy' ? 'Pay with' : 'Receive in'}</span>
                    <span>
                      <UsdcIcon />
                      USDC <small>on Arc</small>
                    </span>
                  </div>
                  <button
                    type="submit"
                    disabled={!validAmount}
                    className="button button-dark full-width"
                  >
                    Preview {mode === 'buy' ? 'exchange' : 'listing'}{' '}
                    <ArrowRight size={17} />
                  </button>
                  <p className="form-footnote">
                    A preview, before you make your move.
                  </p>
                </form>
              )}
              {storageError && (
                <p className="form-error" role="alert">
                  {storageError}
                </p>
              )}
            </>
          )}
        </Dialog>
      )}

      {modal === 'drafts' && (
        <Dialog title="Your possibilities." close={() => setModal(null)}>
          <p className="dialog-subtitle">Saved here, ready when you are.</p>
          {drafts.length ? (
            <>
              <div className="draft-list">
                {drafts.map((d) => (
                  <button
                    key={d.id}
                    onClick={() => {
                      openTrade(
                        d.mode,
                        vouchers.find((v) => v.name === d.brand) || vouchers[0],
                      )
                      setAmount(String(d.amount))
                    }}
                  >
                    <span className="draft-icon">
                      <CreditCard size={20} />
                    </span>
                    <span>
                      <strong>{d.brand}</strong>
                      <small>
                        {d.mode === 'buy' ? 'Buy' : 'Sell'} voucher ·{' '}
                        {inr(d.amount)}
                      </small>
                    </span>
                    <ArrowUpRight size={18} />
                  </button>
                ))}
              </div>
              <button
                className="text-button clear-drafts"
                onClick={clearDrafts}
              >
                Clear saved drafts
              </button>
            </>
          ) : (
            <div className="empty-state">
              <Clock3 size={28} />
              <h3>A little room for possibility.</h3>
              <p>Your saved voucher previews will appear here.</p>
              <button
                className="button button-dark"
                onClick={() => openTrade('buy')}
              >
                Explore an exchange <ArrowUpRight size={16} />
              </button>
            </div>
          )}
          {storageError && (
            <p className="form-error" role="alert">
              {storageError}
            </p>
          )}
        </Dialog>
      )}

      {modal === 'privacy' && (
        <Dialog title="Your details stay yours." close={() => setModal(null)}>
          <div className="privacy-copy">
            <p>
              This frontend stores only your saved voucher drafts in this
              browser: brand, amount, exchange side and time. Clear them from
              the drafts panel whenever you like.
            </p>
            <p>
              Wallet addresses stay in memory for the current page session.
              Connecting requests account access from your wallet. This frontend
              does not request signatures, send transactions, or collect voucher
              codes, card numbers or private keys.
            </p>
            <p>
              There are no analytics trackers or account sign-ups. External
              links and your wallet provider have their own privacy policies.
            </p>
          </div>
        </Dialog>
      )}
    </>
  )
}
