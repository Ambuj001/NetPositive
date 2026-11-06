import { AnimatePresence, motion } from 'motion/react'
import {
  ArrowRight,
  Check,
  Copy,
  LoaderCircle,
  Menu,
  ShieldCheck,
  UserRound,
  Wallet,
  X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import {
  Link,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
} from 'react-router-dom'
import { useApp } from '../lib/store'
import { Logo, cx } from './ui'
import { WalletLogo } from './WalletLogos'
import { Dialog } from './Dialog'

const LINKS = [
  { to: '/home', label: 'Trade' },
  { to: '/market', label: 'Market' },
  { to: '/cards', label: 'My cards' },
]
export function Shell() {
  const { pathname } = useLocation()
  useEffect(() => {
    window.scrollTo({ top: 0 })
    document.title = `${pathname === '/' ? 'More value, both ways' : pathname === '/home' ? 'Trade' : pathname === '/market' ? 'Market' : pathname === '/cards' ? 'My cards' : 'Profile'} · NetPositive`
  }, [pathname])
  return (
    <div className="np-app trade-shell">
      <Nav />
      <main>
        <Outlet />
      </main>
      {pathname === '/' && <Footer />}
      <WalletModal />
      <Toaster />
    </div>
  )
}
function Nav() {
  const { address, username, humanVerified, openWallet } = useApp()
  const [open, setOpen] = useState(false)
  const { pathname, search } = useLocation()
  useEffect(() => {
    setOpen(false)
  }, [pathname, search])
  return (
    <header className="np-header">
      <nav className="np-nav" aria-label="Main navigation">
        <Logo />
        <div className="np-nav-links">
          {LINKS.map((l) => (
            <NavLink
              key={l.to}
              to={l.to}
              className={({ isActive }) =>
                cx('np-nav-link', isActive && 'active')
              }
            >
              {({ isActive }) => (
                <>
                  {isActive && (
                    <motion.span
                      layoutId="nav-pill"
                      className="nav-active"
                      transition={{
                        type: 'spring',
                        stiffness: 350,
                        damping: 30,
                      }}
                    />
                  )}
                  <span>{l.label}</span>
                </>
              )}
            </NavLink>
          ))}
        </div>
        <div className="nav-account">
          <NavLink
            to="/profile"
            className={({ isActive }) =>
              cx('profile-link', isActive && 'active')
            }
            aria-label="Profile"
          >
            <UserRound size={17} />
            <span>{username || 'Profile'}</span>
            {humanVerified && <ShieldCheck size={14} />}
          </NavLink>
          <button className="np-button compact" onClick={openWallet}>
            <Wallet size={15} />
            <span>{address || 'Connect'}</span>
          </button>
          <button
            className="icon-button mobile-menu"
            onClick={() => setOpen(!open)}
            aria-label="Toggle navigation"
            aria-expanded={open}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {open && (
          <motion.div
            className="mobile-navigation"
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
          >
            {LINKS.map((l) => (
              <NavLink key={l.to} to={l.to}>
                {l.label}
                <ArrowRight size={15} />
              </NavLink>
            ))}
            <Link to="/profile">
              Profile
              <ArrowRight size={15} />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </header>
  )
}
function Footer() {
  return (
    <footer className="np-footer">
      <Logo />
      <span>More value on both sides.</span>
      <div>
        <Link to="/home?mode=sell">Pay with crypto</Link>
        <Link to="/home">Buy USDC</Link>
        <Link to="/profile">Your account</Link>
        <a
          href="https://github.com/Ambuj001/NetPositive"
          target="_blank"
          rel="noreferrer"
        >
          GitHub
        </a>
      </div>
      <small>ETHGlobal · Prototype</small>
    </footer>
  )
}
function WalletModal() {
  const {
    walletOpen,
    closeWallet,
    address,
    fullAddress,
    chain,
    walletName,
    walletIcon,
    walletId,
    choices,
    pending,
    walletError,
    connect,
    disconnect,
    humanVerified,
    username,
    toast,
  } = useApp()
  const nav = useNavigate()
  const [copied, setCopied] = useState(false)
  const { pathname } = useLocation()
  if (!walletOpen) return null
  return (
    <Dialog
      title={address ? 'Your wallet' : 'Connect wallet'}
      close={closeWallet}
    >
      {!address ? (
        <>
          <div className="wallet-choices">
            {choices.map((w) => (
              <button
                className="wallet-choice"
                key={w.id}
                disabled={!!pending || w.status === 'unavailable'}
                onClick={async () => {
                  if (await connect(w)) {
                    closeWallet()
                    if (pathname === '/') nav('/home')
                  }
                }}
              >
                <WalletLogo id={w.id} name={w.name} icon={w.icon} />
                <span>
                  <strong>{w.name}</strong>
                  <small>
                    {pending === w.id ? 'Approve in your wallet…' : w.hint}
                  </small>
                </span>
                {pending === w.id ? (
                  <LoaderCircle size={17} className="spin" />
                ) : (
                  <span className="status-badge">
                    {w.status === 'installed'
                      ? 'Installed'
                      : w.status === 'install'
                        ? 'Get wallet'
                        : w.status === 'unavailable'
                          ? 'Unavailable'
                          : 'Connect'}
                  </span>
                )}
              </button>
            ))}
          </div>
          {walletError && (
            <p className="form-error" role="alert">
              {walletError}
            </p>
          )}
          <p className="field-hint">Approve the connection in your wallet.</p>
        </>
      ) : (
        <div className="stack">
          <div className="wallet-identity">
            <WalletLogo id={walletId} name={walletName} icon={walletIcon} />
            <div>
              <strong>{username || walletName}</strong>
              <small>
                {address} · {chain || 'Network unavailable'}
              </small>
            </div>
            <button
              className="icon-button"
              aria-label="Copy wallet address"
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(fullAddress)
                  setCopied(true)
                } catch {
                  toast({ title: 'Copy unavailable', body: fullAddress })
                }
              }}
            >
              {copied ? <Check size={17} /> : <Copy size={17} />}
            </button>
          </div>
          <div className="profile-row">
            <span>World ID</span>
            <span className="status-badge">
              {humanVerified ? 'Verified' : 'Not connected'}
            </span>
          </div>
          <button
            className="np-button"
            onClick={() => {
              closeWallet()
              nav('/profile')
            }}
          >
            Manage profile
            <ArrowRight size={16} />
          </button>
          <button
            className="np-button secondary"
            onClick={() => {
              disconnect()
              closeWallet()
            }}
          >
            Disconnect wallet
          </button>
        </div>
      )}
    </Dialog>
  )
}
function Toaster() {
  const { toasts, dismiss } = useApp()
  return (
    <div className="np-toasts" aria-live="polite">
      <AnimatePresence>
        {toasts.map((t) => (
          <motion.button
            key={t.id}
            onClick={() => dismiss(t.id)}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, x: 10 }}
          >
            <Check size={16} />
            <span>
              <strong>{t.title}</strong>
              {t.body && <small>{t.body}</small>}
            </span>
          </motion.button>
        ))}
      </AnimatePresence>
    </div>
  )
}
