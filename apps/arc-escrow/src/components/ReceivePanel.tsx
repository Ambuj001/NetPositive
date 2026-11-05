import { useState } from 'react'
import { Eye, EyeOff, KeyRound } from 'lucide-react'
import { toast } from 'sonner'
import { useVault } from '@/hooks/useVault'
import { api } from '@/lib/api'
import { decryptDelivery } from '@/lib/crypto'
import type { Order } from '@/lib/netpositive'
import { parsePayload, type VoucherPayload } from '@/lib/vault'
import { envelopeDigest } from '@/shared/envelope'
import { VaultGate } from './VaultGate'

/** Buyer flow: fetch ciphertext, check it against the onchain digest, decrypt locally, optionally save to the vault. */
export function ReceivePanel({ order }: { order: Order }) {
  const vault = useVault()
  const [payload, setPayload] = useState<VoucherPayload>()
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [saved, setSaved] = useState(false)

  if (!vault.unlocked) return <VaultGate reason="Unlock to decrypt this delivery with your recipient key." />
  const key = vault.findRecipientKey(order.tradeId)
  if (!key) {
    return (
      <p className="inner text-sm" style={{ color: 'var(--warn)' }}>
        This vault has no recipient key for this order. Import your recovery export, or use the browser where you created the order.
      </p>
    )
  }

  const decrypt = async () => {
    setBusy(true)
    try {
      const envelope = await api.getEnvelope(order.deliveryDigest)
      if (envelopeDigest(envelope).toLowerCase() !== order.deliveryDigest.toLowerCase()) {
        throw new Error('Ciphertext does not match the digest recorded onchain. Do not accept.')
      }
      setPayload(parsePayload(await decryptDelivery(envelope, key)))
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not decrypt')
    } finally {
      setBusy(false)
    }
  }

  const save = async () => {
    if (!payload) return
    await vault.addRecord({ ...payload, source: 'delivery', tradeId: order.tradeId })
    setSaved(true)
    toast.success('Saved to your vault')
  }

  return (
    <div className="inner space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        <KeyRound size={16} /> Decrypt delivery locally
      </div>
      {!payload ? (
        <button className="btn-ghost w-full" onClick={() => void decrypt()} disabled={busy}>
          {busy ? 'Decrypting...' : 'Fetch and decrypt'}
        </button>
      ) : (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between gap-2">
            <span style={{ color: 'var(--muted)' }}>{payload.merchant || 'Voucher'}</span>
            <span className="tnum font-semibold">{payload.faceValue}</span>
          </div>
          <div className="mono flex items-center justify-between gap-2 break-all rounded-xl bg-white/80 p-3">
            <span>{shown ? payload.code : '•••• •••• •••• ••••'}</span>
            <button type="button" aria-label={shown ? 'Hide code' : 'Reveal code'} className="btn-ghost !min-h-[36px] !px-2" onClick={() => setShown((s) => !s)}>
              {shown ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          {shown && payload.pin && <div className="mono text-xs">PIN {payload.pin}</div>}
          <p className="text-xs" style={{ color: 'var(--muted)' }}>
            Test the voucher with the issuer before the review window closes. The attestation proves delivery, not validity.
          </p>
          <button className="btn-ghost w-full" onClick={() => void save()} disabled={saved}>
            {saved ? 'Saved to vault' : 'Save to vault'}
          </button>
        </div>
      )}
    </div>
  )
}
