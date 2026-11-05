import { ConnectKitButton } from 'connectkit'
import { useAccount, useReadContract } from 'wagmi'
import { erc20Abi } from 'viem'
import { ShieldCheck } from 'lucide-react'
import { CHAIN_ID, USDC_ADDRESS } from '@/lib/netpositive'
import { formatUsdc } from '@/onchain-money'

export type Tab = 'escrow' | 'vault' | 'architecture' | 'trust'

const TABS: { id: Tab; label: string }[] = [
  { id: 'escrow', label: 'Escrow' },
  { id: 'vault', label: 'Vault' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'trust', label: 'Trust & CROPS' },
]

function UsdcBalance() {
  const { address } = useAccount()
  // One USDC balance, ERC-20 view (6 decimals). On Arc this is the same pool as the native gas balance.
  const { data } = useReadContract({
    address: USDC_ADDRESS,
    abi: erc20Abi,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(address), refetchInterval: 10_000 },
  })
  if (data === undefined) return null
  return <span className="chip tnum hidden sm:inline-flex">{formatUsdc(data)} USDC</span>
}

export function Header({ tab, onTab }: { tab: Tab; onTab: (t: Tab) => void }) {
  return (
    <header className="sticky top-0 z-20 border-b backdrop-blur-md" style={{ borderColor: 'var(--border)', background: 'rgba(255,255,255,0.7)' }}>
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-3 px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="grid h-9 w-9 place-items-center rounded-xl text-white" style={{ background: 'var(--accent)' }}>
            <ShieldCheck size={18} />
          </span>
          <div className="leading-tight">
            <div className="display text-lg font-bold">NetPositive</div>
            <div className="text-[11px]" style={{ color: 'var(--subtle)' }}>
              USDC voucher escrow, Arc Testnet
            </div>
          </div>
        </div>
        <nav className="order-3 flex w-full gap-1 overflow-x-auto sm:order-none sm:ml-6 sm:w-auto" aria-label="Sections">
          {TABS.map((t) => (
            <button
              key={t.id}
              type="button"
              onClick={() => onTab(t.id)}
              aria-current={tab === t.id ? 'page' : undefined}
              className="min-h-[44px] whitespace-nowrap rounded-xl px-3 text-sm font-semibold transition"
              style={{
                background: tab === t.id ? 'var(--accent)' : 'transparent',
                color: tab === t.id ? '#fff' : 'var(--ink-2)',
              }}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <UsdcBalance />
          <ConnectKitButton />
        </div>
      </div>
    </header>
  )
}
