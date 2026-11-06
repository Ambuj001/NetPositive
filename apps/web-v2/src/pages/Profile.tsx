import {
  IDKitRequestWidget,
  proofOfHuman,
  type RpContext,
  type IDKitResult,
} from '@worldcoin/idkit'
import {
  ArrowRight,
  Check,
  Copy,
  FingerprintPattern,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  UserRound,
  Wallet,
} from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { motion } from 'motion/react'
import { useApp } from '../lib/store'
import { api, type AccountUser, type RemoteOrder } from '../lib/account'
import { Dialog } from '../components/Dialog'
import { WalletLogo } from '../components/WalletLogos'
import { inr } from '../lib/engine'
type WorldRequest = {
  app_id: `app_${string}`
  action: string
  signal: string
  environment: 'production' | 'staging'
  rp_context: RpContext
}
export default function Profile() {
  const {
    address,
    fullAddress,
    walletName,
    walletId,
    walletIcon,
    chain,
    openWallet,
    disconnect,
    username,
    saveUsername,
    token,
    signIn,
    humanVerified,
    refreshUser,
    accountUser,
    toast,
  } = useApp()
  const [params, setParams] = useSearchParams()
  const tab = params.get('tab') === 'disputes' ? 'disputes' : 'account'
  const [name, setName] = useState(username)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState('')
  const [world, setWorld] = useState<WorldRequest | null>(null)
  const [requests, setRequests] = useState<RemoteOrder[]>([])
  const [loaded, setLoaded] = useState(false)
  const [requestError, setRequestError] = useState('')
  const [disputing, setDisputing] = useState<RemoteOrder | null>(null)
  const [reason, setReason] = useState('')
  const ownerRef = useRef(fullAddress)
  ownerRef.current = fullAddress
  const generation = useRef(0)
  useEffect(() => {
    generation.current++
    setName(username)
    setWorld(null)
    setError('')
    setRequests([])
    setLoaded(false)
    setLoading('')
    setRequestError('')
    setDisputing(null)
  }, [fullAddress])
  useEffect(() => {
    setName(username)
  }, [username])
  const run = async (key: string, task: () => Promise<void>) => {
    const id = generation.current
    setError('')
    setLoading(key)
    try {
      await task()
    } catch (e) {
      if (generation.current === id) setError((e as Error).message)
    } finally {
      if (generation.current === id) setLoading('')
    }
  }
  const loadRequests = async (t: string) => {
    const owner = fullAddress
    setRequestError('')
    try {
      const data = await api<{
        asRequester: RemoteOrder[]
        asFulfiller: RemoteOrder[]
      }>('/requests/mine', t)
      if (ownerRef.current !== owner) return
      const all = [...data.asRequester, ...data.asFulfiller]
      setRequests([...new Map(all.map((o) => [o.id, o])).values()])
      setLoaded(true)
    } catch (e) {
      if (ownerRef.current === owner) {
        setRequestError((e as Error).message)
        setLoaded(false)
      }
    }
  }
  useEffect(() => {
    if (token) void loadRequests(token)
  }, [token, fullAddress])
  const startWorld = () =>
    run('world', async () => {
      const owner = fullAddress,
        t = token || (await signIn())
      const health = await api<{ ok: boolean; worldIdMock: boolean }>('/health')
      if (health.worldIdMock !== false)
        throw new Error(
          'World ID verification is not enabled on this service yet.',
        )
      const data = await api<WorldRequest>('/world-id/request', t, {})
      if (ownerRef.current !== owner) return
      if (
        data.signal.toLowerCase() !== owner ||
        !data.app_id?.startsWith('app_') ||
        !data.rp_context?.rp_id ||
        !['staging', 'production'].includes(data.environment)
      )
        throw new Error('Verification request could not be validated.')
      setWorld(data)
    })
  const verify = async (result: IDKitResult) => {
    if (!world || ownerRef.current !== world.signal.toLowerCase())
      throw new Error('Wallet changed. Start again.')
    const owner = fullAddress
    const response = await api<{ verified: boolean; user: AccountUser }>(
      '/world-id/verify',
      token,
      result,
    )
    if (ownerRef.current !== owner)
      throw new Error('Wallet changed. Start again.')
    if (
      response.verified !== true ||
      !response.user?.worldIdNullifier ||
      response.user.banned
    )
      throw new Error('Verification was not accepted.')
    refreshUser(response.user)
  }
  const disputes = requests.filter(
    (r) => r.disputedAt || r.disputeReason || r.status === 'disputed',
  )
  const eligible = requests.filter((r) => r.status === 'code_submitted')
  return (
    <div className="page-wrap">
      <div className="page-heading">
        <div>
          <span className="eyebrow">Your account</span>
          <h1>{username ? `Hello, ${username}.` : 'Make yourself at home.'}</h1>
          <p>Your wallet, identity, and trade history in one place.</p>
        </div>
        {address && (
          <span className="status-badge connected">
            <span />
            Wallet connected
          </span>
        )}
      </div>
      <div
        className="profile-tabs"
        role="tablist"
        aria-label="Profile sections"
      >
        {(['account', 'disputes'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            id={`${v}-tab`}
            aria-controls={`${v}-panel`}
            aria-selected={tab === v}
            onClick={() =>
              setParams(v === 'account' ? {} : { tab: 'disputes' })
            }
          >
            {v === 'account' ? 'Account' : 'Disputes'}
            {v === 'disputes' && disputes.length > 0 && (
              <span>{disputes.length}</span>
            )}
          </button>
        ))}
      </div>
      {!address ? (
        <div className="np-panel empty-state">
          <Wallet size={30} />
          <h2>Connect your wallet.</h2>
          <p>Set up your profile and view your trades.</p>
          <button className="np-button" onClick={openWallet}>
            Connect wallet
            <ArrowRight size={16} />
          </button>
        </div>
      ) : (
        <motion.div
          key={tab}
          role="tabpanel"
          id={`${tab}-panel`}
          aria-labelledby={`${tab}-tab`}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3 }}
        >
          {tab === 'account' ? (
            <div className="profile-layout">
              <div className="stack">
                <section className="np-panel padded">
                  <div className="panel-heading">
                    <h2>Profile</h2>
                    <UserRound size={18} />
                  </div>
                  <div className="profile-avatar">
                    {(username || address).slice(0, 2).toUpperCase()}
                  </div>
                  <form
                    className="stack"
                    onSubmit={(e) => {
                      e.preventDefault()
                      try {
                        saveUsername(name)
                        toast({ title: 'Username saved' })
                        setError('')
                      } catch (e) {
                        setError((e as Error).message)
                      }
                    }}
                  >
                    <label className="np-field">
                      <span>Username</span>
                      <input
                        value={name}
                        onChange={(e) => setName(e.target.value)}
                        required
                        minLength={3}
                        maxLength={24}
                        pattern="[a-zA-Z0-9_]+"
                        placeholder="Your username"
                        autoComplete="nickname"
                      />
                    </label>
                    <p className="field-hint">
                      3–24 letters, numbers, or underscores. Saved on this
                      device for this wallet.
                    </p>
                    <button
                      type="submit"
                      className="np-button secondary"
                      disabled={name.trim() === username}
                    >
                      Save changes
                      <Check size={16} />
                    </button>
                  </form>
                </section>
                <section className="np-panel padded">
                  <div className="panel-heading">
                    <h2>Connected wallet</h2>
                    <Wallet size={18} />
                  </div>
                  <div className="wallet-identity">
                    <WalletLogo
                      id={walletId}
                      name={walletName}
                      icon={walletIcon}
                    />
                    <div>
                      <strong>{walletName}</strong>
                      <small>{chain || 'Network unavailable'}</small>
                    </div>
                    <button
                      className="icon-button"
                      aria-label="Copy wallet address"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(fullAddress)
                          toast({ title: 'Address copied' })
                        } catch {
                          setError(
                            'Clipboard unavailable. Copy the address below.',
                          )
                        }
                      }}
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                  <code className="address-text">{fullAddress}</code>
                  <div className="profile-row">
                    <span>Account session</span>
                    <span className="status-badge">
                      {token ? 'Signed in' : 'Not signed in'}
                    </span>
                  </div>
                  <div className="button-row">
                    <button
                      className="np-button secondary"
                      onClick={() =>
                        void run('signin', async () => {
                          await signIn()
                          toast({ title: 'Signed in' })
                        })
                      }
                      disabled={!!loading}
                    >
                      {loading === 'signin' && (
                        <LoaderCircle className="spin" size={15} />
                      )}
                      {token ? 'Refresh session' : 'Sign in with wallet'}
                    </button>
                    <button className="np-button ghost" onClick={disconnect}>
                      Disconnect
                    </button>
                  </div>
                </section>
              </div>
              <div className="stack">
                <section className="np-panel padded world-panel">
                  <div className="panel-heading">
                    <h2>World ID</h2>
                    <FingerprintPattern size={22} />
                  </div>
                  <div className="identity-visual">
                    <FingerprintPattern size={43} strokeWidth={1.2} />
                    {humanVerified && (
                      <span>
                        <Check size={14} />
                      </span>
                    )}
                  </div>
                  <h3>
                    {humanVerified
                      ? 'You’re verified.'
                      : 'One person. One account.'}
                  </h3>
                  <p>
                    Link your World ID to this wallet with a proof of humanity.
                  </p>
                  <div className="profile-row">
                    <span>Status</span>
                    <span className="status-badge">
                      {humanVerified ? 'Verified' : 'Not connected'}
                    </span>
                  </div>
                  {!humanVerified && (
                    <button
                      className="np-button"
                      disabled={!!loading || !!accountUser?.banned}
                      onClick={() => void startWorld()}
                    >
                      {loading === 'world' ? (
                        <LoaderCircle className="spin" size={16} />
                      ) : (
                        <ShieldCheck size={16} />
                      )}
                      {loading === 'world'
                        ? 'Preparing request…'
                        : accountUser?.banned
                          ? 'Account restricted'
                          : 'Connect World ID'}
                    </button>
                  )}
                </section>
                <section className="np-panel padded">
                  <div className="panel-heading">
                    <h2>Trade activity</h2>
                    <button
                      className="icon-button"
                      aria-label="Refresh trade activity"
                      disabled={!token || !!loading}
                      onClick={() =>
                        void run('requests', () => loadRequests(token))
                      }
                    >
                      <RefreshCw
                        size={16}
                        className={loading === 'requests' ? 'spin' : ''}
                      />
                    </button>
                  </div>
                  {loaded ? (
                    <div className="profile-stats">
                      <div>
                        <strong>
                          {accountUser?.reputation?.completed ??
                            requests.filter((r) => r.status === 'released')
                              .length}
                        </strong>
                        <span>Completed</span>
                      </div>
                      <div>
                        <strong>
                          {
                            requests.filter(
                              (r) =>
                                !['released', 'refunded', 'cancelled'].includes(
                                  r.status,
                                ),
                            ).length
                          }
                        </strong>
                        <span>Active</span>
                      </div>
                      <div>
                        <strong>{disputes.length}</strong>
                        <span>Disputes</span>
                      </div>
                    </div>
                  ) : (
                    <p className="field-hint">
                      {requestError ||
                        'Sign in with your wallet to load your trade history.'}
                    </p>
                  )}
                  <Link className="np-text-link" to="/profile?tab=disputes">
                    Track disputes
                    <ArrowRight size={15} />
                  </Link>
                </section>
              </div>
            </div>
          ) : (
            <section className="np-panel padded">
              <div className="panel-heading">
                <h2>Dispute tracking</h2>
                <button
                  className="np-button secondary compact"
                  disabled={!!loading}
                  onClick={() =>
                    void run('requests', async () => {
                      const t = token || (await signIn())
                      await loadRequests(t)
                    })
                  }
                >
                  {loading === 'requests' ? (
                    <LoaderCircle size={15} className="spin" />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                  {token ? 'Refresh' : 'Sign in to load'}
                </button>
              </div>
              {requestError && (
                <p className="form-error" role="alert">
                  {requestError}
                </p>
              )}
              {!loaded ? (
                <div className="empty-state">
                  <ShieldCheck size={28} />
                  <h3>Your trade history stays with you.</h3>
                  <p>Sign in to securely load disputes for this wallet.</p>
                </div>
              ) : (
                <>
                  {disputes.map((r) => (
                    <div className="dispute-row" key={r.id}>
                      <div className="panel-heading">
                        <div>
                          <strong>
                            {r.brand} · {inr(r.amountInr)}
                          </strong>
                          <small className="subtle-label">{r.id}</small>
                        </div>
                        <span className="status-badge">
                          {r.status.replaceAll('_', ' ')}
                        </span>
                      </div>
                      <p>{r.disputeReason}</p>
                      <div className="dispute-timeline">
                        <span className="complete">Opened</span>
                        <i />
                        <span
                          className={
                            r.status !== 'disputed' ? 'complete' : 'current'
                          }
                        >
                          Review
                        </span>
                        <i />
                        <span className={r.resolution ? 'complete' : ''}>
                          {r.resolution
                            ? r.resolution.outcome === 'refund'
                              ? 'Refunded'
                              : 'Resolved'
                            : 'Resolution'}
                        </span>
                      </div>
                      {r.resolution?.note && (
                        <p className="field-hint">{r.resolution.note}</p>
                      )}
                      {r.disputedAt && (
                        <small className="subtle-label">
                          Opened{' '}
                          {new Date(r.disputedAt).toLocaleDateString('en-IN')}
                        </small>
                      )}
                    </div>
                  ))}
                  {!disputes.length && (
                    <div className="empty-state">
                      <Check size={28} />
                      <h3>No disputes.</h3>
                      <p>Any disputes for your trades will appear here.</p>
                    </div>
                  )}
                  {eligible.length > 0 && (
                    <>
                      <h3 className="section-small-title">
                        Trades eligible for a dispute
                      </h3>
                      {eligible.map((r) => (
                        <div className="profile-row" key={r.id}>
                          <div>
                            <strong>
                              {r.brand} · {inr(r.amountInr)}
                            </strong>
                            <small>{r.id}</small>
                          </div>
                          <button
                            className="np-button secondary compact"
                            onClick={() => {
                              setDisputing(r)
                              setReason('')
                              setError('')
                            }}
                          >
                            Report an issue
                          </button>
                        </div>
                      ))}
                    </>
                  )}
                </>
              )}
            </section>
          )}
          {error && (
            <p role="alert" className="form-error">
              {error}
            </p>
          )}
        </motion.div>
      )}
      {world && (
        <IDKitRequestWidget
          app_id={world.app_id}
          action={world.action}
          rp_context={world.rp_context}
          environment={world.environment}
          allow_legacy_proofs={false}
          preset={proofOfHuman({ signal: world.signal })}
          open
          onOpenChange={(open) => {
            if (!open) setWorld(null)
          }}
          handleVerify={verify}
          onSuccess={() => {
            setWorld(null)
            toast({ title: 'World ID connected' })
          }}
          onError={() =>
            setError('Verification did not finish. Please try again.')
          }
        />
      )}
      {disputing && (
        <Dialog title="Report an issue" close={() => setDisputing(null)}>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault()
              void run('dispute', async () => {
                if (!token)
                  throw new Error('Sign in again before reporting an issue.')
                await api(
                  `/requests/${encodeURIComponent(disputing.id)}/dispute`,
                  token,
                  { reason: reason.trim() },
                )
                setDisputing(null)
                await loadRequests(token)
                toast({ title: 'Dispute opened' })
              })
            }}
          >
            <p>
              {disputing.brand} · {inr(disputing.amountInr)}
            </p>
            <label className="np-field">
              <span>What happened?</span>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                minLength={5}
                maxLength={1000}
                required
                rows={4}
              />
            </label>
            <p className="field-hint">
              Describe the issue. Do not include voucher codes or card details.
            </p>
            {error && (
              <p className="form-error" role="alert">
                {error}
              </p>
            )}
            <button
              className="np-button"
              disabled={!!loading || reason.trim().length < 5}
              type="submit"
            >
              {loading === 'dispute' ? 'Submitting…' : 'Open dispute'}
              <ArrowRight size={16} />
            </button>
          </form>
        </Dialog>
      )}
    </div>
  )
}
