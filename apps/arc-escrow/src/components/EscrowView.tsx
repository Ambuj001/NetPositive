import { useState } from 'react'
import { useAccount } from 'wagmi'
import { useQuery } from '@tanstack/react-query'
import { isHex } from 'viem'
import { AlertTriangle, RefreshCw } from 'lucide-react'
import { toast } from 'sonner'
import { useOrders } from '@/hooks/useOrders'
import { api } from '@/lib/api'
import { NP_ADDRESS } from '@/lib/netpositive'
import { CreateOrder } from './CreateOrder'
import { OrderCard } from './OrderCard'
import { WithdrawCard } from './WithdrawCard'

function Notice({ children }: { children: React.ReactNode }) {
  return (
    <div role="status" className="flex items-start gap-2 rounded-2xl border p-3 text-sm" style={{ borderColor: 'rgba(138,90,0,0.3)', background: 'rgba(255,248,230,0.8)', color: 'var(--warn)' }}>
      <AlertTriangle size={16} className="mt-0.5 shrink-0" />
      <div>{children}</div>
    </div>
  )
}

export function EscrowView() {
  const { address } = useAccount()
  const { orders, scan, refresh, track } = useOrders(address)
  const [lookup, setLookup] = useState('')
  const backend = useQuery({ queryKey: ['np-backend'], queryFn: api.config, retry: false, refetchInterval: 30_000 })

  const lookupOrder = async () => {
    if (!isHex(lookup, { strict: true }) || lookup.length !== 66) return toast.error('Trade IDs are 32-byte hex values.')
    await track(lookup)
    setLookup('')
  }

  return (
    <div className="space-y-4">
      {!NP_ADDRESS && (
        <Notice>
          The NetPositive contract is not deployed to Arc Testnet yet, so orders are disabled. After deployment, set <span className="mono">VITE_NETPOSITIVE_ADDRESS</span> and <span className="mono">VITE_NETPOSITIVE_DEPLOY_BLOCK</span> in <span className="mono">.env</span> and restart the dev server.
        </Notice>
      )}
      {backend.isError && (
        <Notice>
          The backend is not reachable. Run <span className="mono">bun run server</span>. Without it, deliveries cannot be uploaded or attested.
        </Notice>
      )}
      {backend.data && !backend.data.validatorConfigured && <Notice>The backend has no validator key configured, so it cannot sign delivery attestations.</Notice>}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
        <div className="space-y-4">
          <CreateOrder onCreated={(id) => void track(id)} />
          <WithdrawCard />
        </div>
        <section className="space-y-3" aria-labelledby="orders-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="orders-title" className="display text-xl font-semibold">Your orders</h2>
            <button className="btn-ghost !min-h-[40px]" onClick={() => void refresh()} aria-label="Refresh orders">
              <RefreshCw size={14} className={scan.status === 'scanning' ? 'animate-spin' : ''} /> Refresh
            </button>
          </div>
          {scan.status === 'scanning' && scan.head !== undefined && scan.at !== undefined && (
            <p className="text-xs tnum" style={{ color: 'var(--muted)' }}>
              Scanning blocks: at {scan.at.toString()} of {scan.head.toString()} ({(scan.head - scan.at).toString()} remaining)
            </p>
          )}
          {scan.status === 'error' && <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>Scan failed: {scan.message}</p>}
          <div className="flex gap-2">
            <input className="field mono" placeholder="Look up a trade ID (0x...)" value={lookup} onChange={(e) => setLookup(e.target.value.trim())} aria-label="Trade ID" />
            <button className="btn-ghost" onClick={() => void lookupOrder()} disabled={!address || !NP_ADDRESS}>Add</button>
          </div>
          {orders.length === 0 ? (
            <div className="card text-sm" style={{ color: 'var(--muted)' }}>
              {address ? 'No orders for this wallet yet. Fund one, or add a trade ID you were given.' : 'Connect a wallet to see your orders.'}
            </div>
          ) : (
            orders.map((o) => <OrderCard key={o.tradeId} order={o} onChanged={() => void refresh()} />)
          )}
        </section>
      </div>
    </div>
  )
}
