import { useState } from 'react'
import { useAccount, useReadContract } from 'wagmi'
import { isAddress, type Address } from 'viem'
import { toast } from 'sonner'
import { netPositiveAbi } from '@/abi/netPositiveAbi'
import { useSend } from '@/hooks/useNp'
import { CHAIN_ID, NP_ADDRESS } from '@/lib/netpositive'
import { formatUsdc } from '@/onchain-money'

/** Pull-payment balance. Every settlement only credits; each account withdraws its own credit. */
export function WithdrawCard() {
  const { address } = useAccount()
  const { send, phase, busy } = useSend()
  const [to, setTo] = useState('')
  const { data, refetch } = useReadContract({
    address: NP_ADDRESS,
    abi: netPositiveAbi,
    functionName: 'withdrawable',
    args: address ? [address] : undefined,
    chainId: CHAIN_ID,
    query: { enabled: Boolean(NP_ADDRESS && address), refetchInterval: 10_000 },
  })
  if (!NP_ADDRESS || !address) return null
  const dest = (to === '' ? address : to) as Address
  const valid = isAddress(dest)
  const amount = data ?? 0n

  const withdraw = async () => {
    if (!NP_ADDRESS) return
    const ok = await send({ address: NP_ADDRESS, abi: netPositiveAbi, functionName: 'withdraw', args: [dest] })
    if (ok) {
      toast.success('Withdrawn')
      void refetch()
    }
  }

  return (
    <section className="card space-y-3" aria-labelledby="wd-title">
      <h2 id="wd-title" className="display text-xl font-semibold">Your withdrawable balance</h2>
      <div className="display tnum text-4xl font-semibold">{formatUsdc(amount)} <span className="text-lg">USDC</span></div>
      <label className="block">
        <span className="label">Send to (optional)</span>
        <input className="field mono mt-1" placeholder={address} value={to} onChange={(e) => setTo(e.target.value.trim())} />
      </label>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        A blocked or failing recipient only affects its own withdrawal. You can redirect yours to another address.
      </p>
      <button className="btn-primary w-full" disabled={amount === 0n || !valid || busy} onClick={() => void withdraw()}>
        {phase === 'wallet' ? 'Confirm in wallet...' : phase === 'confirming' ? 'Confirming...' : 'Withdraw'}
      </button>
    </section>
  )
}
