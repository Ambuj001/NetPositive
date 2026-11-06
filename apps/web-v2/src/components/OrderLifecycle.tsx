import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, Eye, LoaderCircle, RefreshCw } from 'lucide-react'
import { useApp } from '../lib/store'
import { orderApi, STATUS, type ApiRequest } from '../lib/order-api'
import {
  denominations,
  expiryOk,
  formatExpiry,
  voucherOk,
  type VoucherDetails,
} from '../lib/vouchers'
import { inr } from '../lib/engine'
import type { Order } from '../lib/data'
import type { FulfilOption } from '../lib/chatbot'
import { Dialog } from './Dialog'

type Props = { order: Order; route?: FulfilOption | null }
/** Inline continuation of upstream route/checklist/PIN/expiry steps, without autoplay or simulated payouts. */
export function OrderLifecycle({ order, route }: Props) {
  const { fullAddress, address, token, signIn, humanVerified, openWallet } =
    useApp()
  const [request, setRequest] = useState<ApiRequest | null>(null)
  const [previewStep, setPreviewStep] = useState<
    'open' | 'accepted' | 'details_ready'
  >('open')
  const [checks, setChecks] = useState([false, false, false, false])
  const splits = denominations(order.amount)
  const [vouchers, setVouchers] = useState<VoucherDetails[]>(() =>
    splits.map(() => ({ code: '', pin: '', expiry: '' })),
  )
  const [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [receipt, setReceipt] = useState(''),
    [reveal, setReveal] = useState<{
      code: string
      pin?: string | null
    } | null>(null)
  const [confirmation, setConfirmation] = useState<'cancel' | 'confirm' | null>(
    null,
  )
  const owner = useRef(fullAddress)
  owner.current = fullAddress
  const live = order.source === 'live'
  const requester = live
    ? request?.requester === fullAddress
    : order.seller === 'you'
  const status = request?.status ?? 'open'
  const mounted = useRef(true)
  const load = async () => {
    try {
      const r = await orderApi.get(order.id)
      if (mounted.current) setRequest(r.request)
    } catch (e) {
      if (mounted.current) setError((e as Error).message)
    }
  }
  useEffect(() => {
    mounted.current = true
    if (live) {
      void load()
      const timer = setInterval(() => void load(), 10000)
      return () => {
        mounted.current = false
        clearInterval(timer)
      }
    }
    return () => {
      mounted.current = false
    }
  }, [order.id, live])
  const action = async (
    work: (t: string) => Promise<{ request: ApiRequest }>,
    needsHuman = false,
  ) => {
    if (busy) return
    setBusy(true)
    setError('')
    const wallet = fullAddress
    try {
      if (!address) {
        openWallet()
        return
      }
      if (needsHuman && !humanVerified)
        throw new Error('Connect World ID in Profile before continuing.')
      const t = token || (await signIn())
      const r = await work(t)
      if (mounted.current && owner.current === wallet) setRequest(r.request)
    } catch (e) {
      if (mounted.current && owner.current === wallet)
        setError((e as Error).message)
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  const roleAllowed =
    !!request &&
    (request.requester === fullAddress || request.fulfiller === fullAddress)
  const needsDetails = live
    ? status === 'accepted' && request?.fulfiller === fullAddress
    : previewStep === 'accepted' && !requester
  return (
    <div className="chat-lifecycle">
      <div className="panel-heading">
        <div>
          <strong>
            {order.brandName || order.brandId} · {inr(order.amount)}
          </strong>
          <small>{order.id}</small>
        </div>
        <span className="status-badge">
          {live ? (request ? STATUS[status] : 'Loading…') : 'Preview'}
        </span>
        {live && (
          <button
            className="icon-button"
            aria-label="Refresh order status"
            onClick={() => void load()}
          >
            <RefreshCw size={14} />
          </button>
        )}
      </div>
      <div className="inline-progress">
        {['Request', 'Accepted', 'Voucher', 'Settlement'].map((s, i) => (
          <span
            key={s}
            className={
              (live
                ? ['open', 'pending_funding'].includes(status)
                  ? 0
                  : status === 'accepted'
                    ? 1
                    : status === 'code_submitted' || status === 'disputed'
                      ? 2
                      : 3
                : previewStep === 'open'
                  ? 0
                  : previewStep === 'accepted'
                    ? 1
                    : 2) >= i
                ? 'active'
                : ''
            }
          >
            {s}
          </span>
        ))}
      </div>
      {!live && requester ? (
        <p className="field-hint">
          Request saved for this session. No USDC has moved. You can follow
          funded requests here when the account service is connected.
        </p>
      ) : !live && previewStep === 'open' ? (
        <button
          className="np-button secondary compact"
          onClick={() => setPreviewStep('accepted')}
        >
          Continue preview
          <ArrowRight size={14} />
        </button>
      ) : null}
      {live && request && (
        <>
          <div className="profile-row">
            <span>Escrow amount</span>
            <strong>{request.amountUsdc} USDC</strong>
          </div>
          {status === 'pending_funding' && requester && (
            <form
              className="stack"
              onSubmit={(e) => {
                e.preventDefault()
                void action((t) => orderApi.fund(order.id, t, receipt), true)
              }}
            >
              <p className="field-hint">
                Fund this request in Arc escrow, then register the confirmed
                deposit transaction.
              </p>
              <code className="address-text">
                Escrow ID: {request.escrowId}
              </code>
              <label className="np-field">
                <span>Deposit transaction hash</span>
                <input
                  value={receipt}
                  onChange={(e) => setReceipt(e.target.value)}
                  pattern="0x[a-fA-F0-9]{64}"
                  required
                  placeholder="0x…"
                />
              </label>
              <button
                className="np-button compact"
                disabled={busy || !/^0x[\da-fA-F]{64}$/.test(receipt)}
              >
                Register deposit
              </button>
            </form>
          )}
          {status === 'open' && !requester && (
            <button
              className="np-button compact"
              disabled={busy || !request}
              onClick={() =>
                void action((t) => orderApi.accept(order.id, t), true)
              }
            >
              Accept request
              <ArrowRight size={14} />
            </button>
          )}
          {status === 'open' && requester && (
            <p className="field-hint">
              Waiting for a buyer. Your funded request is in the order book.
            </p>
          )}
          {['pending_funding', 'open'].includes(status) && requester && (
            <button
              className="np-button ghost compact"
              disabled={busy}
              onClick={() => setConfirmation('cancel')}
            >
              Cancel request
            </button>
          )}
          {status === 'accepted' && requester && (
            <p className="field-hint">Your buyer is purchasing the voucher.</p>
          )}
        </>
      )}
      {needsDetails && (
        <div className="stack">
          <div className="purchase-route-label">
            {route
              ? `${route.card} · ${route.channel}`
              : 'Your own purchase route'}
          </div>
          <div className="purchase-checks">
            {[
              'The voucher brand matches the request.',
              'The total voucher value matches the request.',
              'The vouchers can be used for this purchase.',
              'I have checked the reward terms and caps.',
            ].map((text, i) => (
              <label key={text}>
                <input
                  type="checkbox"
                  checked={checks[i]}
                  onChange={(e) =>
                    setChecks((all) =>
                      all.map((v, j) => (j === i ? e.target.checked : v)),
                    )
                  }
                />
                <span>{text}</span>
              </label>
            ))}
          </div>
          <p className="field-hint">
            {live
              ? 'Only enter vouchers bought for this accepted request.'
              : 'Preview: use sample details only. Nothing is sent or stored.'}
          </p>
          {vouchers.map((voucher, i) => (
            <fieldset key={i} className="voucher-details">
              <legend>
                Voucher {i + 1} · {inr(splits[i])}
              </legend>
              <label className="np-field">
                <span>Voucher code</span>
                <input
                  type="password"
                  autoComplete="off"
                  spellCheck={false}
                  value={voucher.code}
                  maxLength={128}
                  onChange={(e) =>
                    setVouchers((all) =>
                      all.map((v, j) =>
                        j === i ? { ...v, code: e.target.value } : v,
                      ),
                    )
                  }
                  aria-label={`Voucher ${i + 1} code`}
                />
              </label>
              <div className="form-grid">
                <label className="np-field">
                  <span>PIN</span>
                  <input
                    type="password"
                    autoComplete="off"
                    inputMode="numeric"
                    maxLength={8}
                    value={voucher.pin}
                    onChange={(e) =>
                      setVouchers((all) =>
                        all.map((v, j) =>
                          j === i
                            ? { ...v, pin: e.target.value.replace(/\D/g, '') }
                            : v,
                        ),
                      )
                    }
                    aria-label={`Voucher ${i + 1} PIN`}
                  />
                </label>
                <label className="np-field">
                  <span>Expiry</span>
                  <input
                    autoComplete="off"
                    placeholder="MM/YY"
                    inputMode="numeric"
                    value={voucher.expiry}
                    onChange={(e) =>
                      setVouchers((all) =>
                        all.map((v, j) =>
                          j === i
                            ? { ...v, expiry: formatExpiry(e.target.value) }
                            : v,
                        ),
                      )
                    }
                    aria-label={`Voucher ${i + 1} expiry`}
                    aria-invalid={
                      voucher.expiry.length === 5 && !expiryOk(voucher.expiry)
                    }
                  />
                </label>
              </div>
            </fieldset>
          ))}
          {live && splits.length > 1 ? (
            <p className="form-error">
              This request needs multiple vouchers. The current account API
              supports one code per request; submission is unavailable until it
              supports the full set.
            </p>
          ) : (
            <button
              className="np-button compact"
              disabled={
                busy || !checks.every(Boolean) || !vouchers.every(voucherOk)
              }
              onClick={() => {
                if (live)
                  void action(
                    (t) =>
                      orderApi.submit(
                        order.id,
                        t,
                        vouchers[0].code.trim(),
                        vouchers[0].pin,
                      ),
                    true,
                  )
                else {
                  setPreviewStep('details_ready')
                  setVouchers(
                    splits.map(() => ({ code: '', pin: '', expiry: '' })),
                  )
                }
              }}
            >
              {live ? 'Submit code and PIN' : 'Validate sample details'}
              <ArrowRight size={14} />
            </button>
          )}
          {live && splits.length === 1 && (
            <p className="field-hint">
              Expiry is validated here. The account API currently stores the
              code and PIN only.
            </p>
          )}
        </div>
      )}
      {!live && previewStep === 'details_ready' && (
        <div className="chat-callout">
          <Check size={18} />
          <div>
            <strong>Sample details validated.</strong>
            <p>
              No voucher was sent, verified, or paid out. Live delivery and
              settlement use your account service.
            </p>
          </div>
        </div>
      )}
      {live && status === 'code_submitted' && roleAllowed && (
        <div className="stack">
          <p className="field-hint">
            Voucher submitted. The seller can review it before settlement.
          </p>
          {request?.reviewDeadline && (
            <span className="subtle-label">
              Review deadline:{' '}
              {new Date(request.reviewDeadline).toLocaleString('en-IN')}
            </span>
          )}
          {requester && (
            <>
              <button
                className="np-button secondary compact"
                disabled={busy}
                onClick={async () => {
                  setBusy(true)
                  setError('')
                  try {
                    const r = await orderApi.voucher(
                      order.id,
                      token || (await signIn()),
                    )
                    if (mounted.current) setReveal(r.voucher)
                  } catch (e) {
                    if (mounted.current) setError((e as Error).message)
                  } finally {
                    if (mounted.current) setBusy(false)
                  }
                }}
              >
                <Eye size={14} />
                View voucher
              </button>
              {reveal && (
                <div className="revealed-voucher">
                  <code>{reveal.code}</code>
                  <span>PIN {reveal.pin || '—'}</span>
                </div>
              )}
              <button
                className="np-button compact"
                disabled={busy}
                onClick={() => setConfirmation('confirm')}
              >
                Confirm voucher works
              </button>
            </>
          )}
          <Link to="/profile?tab=disputes" className="np-text-link">
            Report an issue
            <ArrowRight size={14} />
          </Link>
        </div>
      )}
      {live &&
        [
          'released',
          'refunded',
          'disputed',
          'releasing',
          'refunding',
          'cancelled',
        ].includes(status) && (
          <div className="chat-callout">
            <Check size={17} />
            <div>
              <strong>{STATUS[status]}</strong>
              {request?.disputeReason && <p>{request.disputeReason}</p>}
              {(request?.releaseTxHash || request?.refundTxHash) && (
                <code className="address-text">
                  {request.releaseTxHash || request.refundTxHash}
                </code>
              )}
              {status === 'disputed' && (
                <Link className="np-text-link" to="/profile?tab=disputes">
                  Track dispute
                  <ArrowRight size={14} />
                </Link>
              )}
            </div>
          </div>
        )}
      {busy && (
        <span className="subtle-label">
          <LoaderCircle size={13} className="spin" />
          Updating request…
        </span>
      )}
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
      {live && !humanVerified && (
        <Link className="np-text-link" to="/profile">
          Connect World ID
          <ArrowRight size={14} />
        </Link>
      )}
      {confirmation && (
        <Dialog
          title={
            confirmation === 'confirm'
              ? 'Confirm voucher and release USDC?'
              : 'Cancel this request?'
          }
          close={() => setConfirmation(null)}
        >
          <p className="field-hint">
            {confirmation === 'confirm'
              ? 'Confirm only after checking the voucher. This asks the account service to release escrow to the buyer.'
              : 'An unfunded request is cancelled. A funded request asks the account service to refund it.'}
          </p>
          <button
            className="np-button"
            disabled={busy}
            onClick={() => {
              const actionName = confirmation
              setConfirmation(null)
              void action((t) =>
                actionName === 'confirm'
                  ? orderApi.confirm(order.id, t)
                  : orderApi.cancel(order.id, t),
              )
            }}
          >
            Confirm
            <ArrowRight size={15} />
          </button>
        </Dialog>
      )}
    </div>
  )
}
