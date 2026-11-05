import { useState } from 'react'
import { useAccount } from 'wagmi'
import { ExternalLink } from 'lucide-react'
import { toast } from 'sonner'
import type { Hex } from 'viem'
import { netPositiveAbi } from '@/abi/netPositiveAbi'
import { useNow, useSend } from '@/hooks/useNp'
import { useVault } from '@/hooks/useVault'
import { api } from '@/lib/api'
import {
  CHAIN_ID,
  NP_ADDRESS,
  OrderState,
  STATE_LABEL,
  formatDuration,
  isTerminal,
  shortHex,
  type Order,
} from '@/lib/netpositive'
import { buildAddressExplorerUrl } from '@/onchain-facts'
import { formatUsdc } from '@/onchain-money'
import { DeliverForm } from './DeliverForm'
import { ReceivePanel } from './ReceivePanel'

type Fn = 'acceptDelivery' | 'openDispute' | 'releaseAfterReview' | 'refundExpired' | 'finalizeUnresolvedDispute'

const tone = (s: OrderState): string =>
  s === OrderState.Released || s === OrderState.ResolvedForFulfiller ? 'var(--success)'
  : s === OrderState.Disputed ? 'var(--danger)'
  : 'var(--ink-2)'

export function OrderCard({ order, onChanged }: { order: Order; onChanged: () => void }) {
  const { address } = useAccount()
  const now = useNow()
  const { send, phase, busy } = useSend()
  const vault = useVault()
  const [panel, setPanel] = useState<'deliver' | 'receive' | null>(null)
  const me = address?.toLowerCase()
  const isBuyer = me === order.buyer.toLowerCase()
  const isFulfiller = me === order.fulfiller.toLowerCase()

  const act = async (functionName: Fn) => {
    if (!NP_ADDRESS) return
    const ok = await send({ address: NP_ADDRESS, abi: netPositiveAbi, functionName, args: [order.tradeId] })
    if (ok) {
      toast.success('Done')
      onChanged()
    }
  }
  const republish = async () => {
    const key = vault.findRecipientKey(order.tradeId)
    if (!key) return toast.error('Unlock the vault that holds this order key first.')
    try {
      await api.publishRecipient(order.tradeId, key.publicKey)
      toast.success('Public key published')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not publish key')
    }
  }

  const pending = phase === 'wallet' ? 'Confirm in wallet...' : phase === 'confirming' ? 'Confirming...' : undefined
  const s = order.state
  const deadlineIn = (t: number) => (t > now ? `${formatDuration(t - now)} left` : 'passed')

  return (
    <article className="card space-y-3" aria-label={`Order ${shortHex(order.tradeId)}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <div className="mono text-xs" style={{ color: 'var(--subtle)' }}>{shortHex(order.tradeId, 10, 6)}</div>
          <div className="display tnum text-2xl font-semibold">{formatUsdc(order.principal)} <span className="text-base">USDC</span></div>
        </div>
        <span className="chip" style={{ color: tone(s) }}>{STATE_LABEL[s]}</span>
      </div>

      <dl className="grid grid-cols-2 gap-2 text-xs">
        <Party label={isBuyer ? 'You (buyer)' : 'Buyer'} addr={order.buyer} />
        <Party label={isFulfiller ? 'You (fulfiller)' : 'Fulfiller'} addr={order.fulfiller} />
      </dl>

      <div className="inner text-sm tnum">
        {s === OrderState.Open && <p>Delivery due: {deadlineIn(order.deliveryDeadline)}. Locked: {formatUsdc(order.principal + order.fee)} USDC.</p>}
        {s === OrderState.Delivered && <p>Review window: {deadlineIn(order.reviewDeadline)}. Digest {shortHex(order.deliveryDigest, 8, 6)}.</p>}
        {s === OrderState.Disputed && (
          <p>
            Arbitrator deadline: {deadlineIn(order.disputeDeadline)}. If it passes without a ruling, anyone can finalize the disclosed 50/50 principal split and the fee returns to the buyer.
          </p>
        )}
        {isTerminal(s) && <p>Settled. Credits are in pull-payment balances; withdraw below.</p>}
      </div>

      <div className="flex flex-wrap gap-2">
        {s === OrderState.Open && isBuyer && (
          <button className="btn-ghost" onClick={() => void republish()}>Publish my public key</button>
        )}
        {s === OrderState.Open && isFulfiller && order.deliveryDeadline > now && (
          <button className="btn-primary" onClick={() => setPanel(panel === 'deliver' ? null : 'deliver')}>Deliver voucher</button>
        )}
        {s === OrderState.Open && order.deliveryDeadline <= now && (
          <button className="btn-primary" disabled={busy} onClick={() => void act('refundExpired')}>{pending ?? 'Refund buyer (anyone)'}</button>
        )}
        {s === OrderState.Delivered && isBuyer && (
          <>
            <button className="btn-ghost" onClick={() => setPanel(panel === 'receive' ? null : 'receive')}>Decrypt delivery</button>
            <button className="btn-primary" disabled={busy} onClick={() => void act('acceptDelivery')}>{pending ?? 'Accept and release'}</button>
            {order.reviewDeadline >= now && (
              <button className="btn-danger" disabled={busy} onClick={() => void act('openDispute')}>Dispute</button>
            )}
          </>
        )}
        {s === OrderState.Delivered && order.reviewDeadline < now && (
          <button className="btn-primary" disabled={busy} onClick={() => void act('releaseAfterReview')}>{pending ?? 'Release (review ended)'}</button>
        )}
        {s === OrderState.Disputed && order.disputeDeadline < now && (
          <button className="btn-primary" disabled={busy} onClick={() => void act('finalizeUnresolvedDispute')}>{pending ?? 'Finalize 50/50 fallback'}</button>
        )}
      </div>

      {panel === 'deliver' && s === OrderState.Open && <DeliverForm order={order} onDone={() => { setPanel(null); onChanged() }} />}
      {panel === 'receive' && s === OrderState.Delivered && <ReceivePanel order={order} />}
    </article>
  )
}

function Party({ label, addr }: { label: string; addr: Hex }) {
  return (
    <div>
      <dt className="label">{label}</dt>
      <dd className="mono mt-0.5">
        <a className="inline-flex items-center gap-1 underline-offset-2 hover:underline" href={buildAddressExplorerUrl(CHAIN_ID, addr)} target="_blank" rel="noopener noreferrer">
          {shortHex(addr)} <ExternalLink size={11} />
        </a>
      </dd>
    </div>
  )
}
