import { useMemo, useState, type FormEvent } from 'react'
import { useAccount, usePublicClient } from 'wagmi'
import { erc20Abi, isAddress, type Address, type Hex } from 'viem'
import { toast } from 'sonner'
import { netPositiveAbi } from '@/abi/netPositiveAbi'
import { useSend } from '@/hooks/useNp'
import { useVault } from '@/hooks/useVault'
import { api } from '@/lib/api'
import { generateRecipientKey, randomHex32 } from '@/lib/crypto'
import {
  CHAIN_ID,
  DELIVERY_WINDOWS,
  MAX_PRINCIPAL,
  MIN_PRINCIPAL,
  NP_ADDRESS,
  USDC_ADDRESS,
  computeTradeId,
  feeFor,
} from '@/lib/netpositive'
import { formatUsdc, parseUsdc } from '@/onchain-money'
import { VaultGate } from './VaultGate'

export function CreateOrder({ onCreated }: { onCreated: (tradeId: Hex) => void }) {
  const { address, isConnected } = useAccount()
  const client = usePublicClient({ chainId: CHAIN_ID })
  const vault = useVault()
  const { send, phase, busy } = useSend()
  const [fulfiller, setFulfiller] = useState('')
  const [amount, setAmount] = useState('25')
  const [windowSec, setWindowSec] = useState<number>(DELIVERY_WINDOWS[1].seconds)
  const [step, setStep] = useState<string>('')

  const principal = useMemo(() => {
    try {
      return parseUsdc(amount)
    } catch {
      return undefined
    }
  }, [amount])
  const fee = principal !== undefined ? feeFor(principal) : undefined
  const problem =
    !isAddress(fulfiller) ? 'Enter the fulfiller wallet address.'
    : fulfiller.toLowerCase() === address?.toLowerCase() ? 'Fulfiller must be a different wallet.'
    : principal === undefined ? 'Enter a USDC amount.'
    : principal < MIN_PRINCIPAL || principal > MAX_PRINCIPAL ? 'Principal must be between 1 and 10,000 USDC.'
    : undefined

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (!NP_ADDRESS || !address || !client || principal === undefined || fee === undefined || problem) return
    const total = principal + fee
    try {
      setStep('Creating recipient key in your vault')
      const key = await generateRecipientKey()
      const salt = randomHex32()
      const tradeId = computeTradeId(NP_ADDRESS, address, salt)
      // Save the private key BEFORE any funds move, so a closed tab can never strand a delivery.
      await vault.addRecipientKey(tradeId, key)

      const allowance = await client.readContract({
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, NP_ADDRESS],
      })
      if (allowance < total) {
        setStep('Approve USDC in your wallet')
        const ok = await send({ address: USDC_ADDRESS, abi: erc20Abi, functionName: 'approve', args: [NP_ADDRESS, total] })
        if (!ok) return
      }
      setStep('Fund the escrow in your wallet')
      const deadline = BigInt(Math.floor(Date.now() / 1000) + windowSec)
      const ok = await send({
        address: NP_ADDRESS,
        abi: netPositiveAbi,
        functionName: 'createOrder',
        args: [salt, fulfiller as Address, principal, deadline, key.keyHash],
      })
      if (!ok) return
      setStep('Publishing your public key for the fulfiller')
      try {
        await api.publishRecipient(tradeId, key.publicKey)
      } catch {
        toast.message('Order funded. Publish your key from the order card so the fulfiller can encrypt to you.')
      }
      toast.success('Escrow funded')
      onCreated(tradeId)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not create order')
    } finally {
      setStep('')
    }
  }

  const notReady = !NP_ADDRESS
  return (
    <section className="card" aria-labelledby="create-title">
      <h2 id="create-title" className="display text-xl font-semibold">
        Fund a voucher order
      </h2>
      <p className="mt-1 text-sm" style={{ color: 'var(--muted)' }}>
        You are the crypto seller. You lock principal plus a 1% fee. The fulfiller gets the full principal only after an attested, encrypted delivery you accept or leave uncontested.
      </p>
      <div className="mt-4 space-y-3">
        {!vault.unlocked ? (
          <VaultGate reason="Your recipient decryption key is stored in the vault before funds move." />
        ) : (
          <form onSubmit={(e) => void submit(e)} className="space-y-3">
            <label className="block">
              <span className="label">Fulfiller wallet</span>
              <input className="field mono mt-1" placeholder="0x..." value={fulfiller} onChange={(e) => setFulfiller(e.target.value.trim())} />
            </label>
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="label">Principal (USDC)</span>
                <input className="field tnum mt-1" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </label>
              <label className="block">
                <span className="label">Delivery window</span>
                <select className="field mt-1" value={windowSec} onChange={(e) => setWindowSec(Number(e.target.value))}>
                  {DELIVERY_WINDOWS.map((w) => (
                    <option key={w.seconds} value={w.seconds}>
                      {w.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <dl className="inner space-y-1 text-sm tnum">
              <Row k="Fulfiller receives" v={principal !== undefined ? `${formatUsdc(principal)} USDC` : '-'} />
              <Row k="Fee (1%, earned only on release)" v={fee !== undefined ? `${formatUsdc(fee)} USDC` : '-'} />
              <Row k="You lock" v={principal !== undefined && fee !== undefined ? `${formatUsdc(principal + fee)} USDC` : '-'} strong />
            </dl>
            <p className="text-xs" style={{ color: 'var(--muted)' }}>
              If nothing is delivered before the window ends, anyone can refund you principal and fee. Fee is split 30% dispute reserve and 70% revenue when earned.
            </p>
            {problem && fulfiller !== '' && (
              <p role="alert" className="text-xs" style={{ color: 'var(--danger)' }}>
                {problem}
              </p>
            )}
            <button className="btn-primary w-full" disabled={!isConnected || notReady || Boolean(problem) || busy || step !== ''}>
              {notReady
                ? 'Contract not deployed yet'
                : !isConnected
                  ? 'Connect a wallet first'
                  : phase === 'wallet'
                    ? 'Confirm in wallet...'
                    : phase === 'confirming'
                      ? 'Waiting for confirmation...'
                      : step || 'Approve and fund escrow'}
            </button>
          </form>
        )}
      </div>
    </section>
  )
}

function Row({ k, v, strong }: { k: string; v: string; strong?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt style={{ color: 'var(--muted)' }}>{k}</dt>
      <dd className={strong ? 'font-semibold' : ''}>{v}</dd>
    </div>
  )
}
