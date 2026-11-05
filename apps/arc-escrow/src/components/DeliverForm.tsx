import { useState, type FormEvent } from 'react'
import { keccak256 } from 'viem'
import { toast } from 'sonner'
import { netPositiveAbi } from '@/abi/netPositiveAbi'
import { useSend } from '@/hooks/useNp'
import { useVault } from '@/hooks/useVault'
import { api } from '@/lib/api'
import { encryptDelivery } from '@/lib/crypto'
import { NP_ADDRESS, type Order } from '@/lib/netpositive'
import { syntheticExample, toPayload } from '@/lib/vault'
import { envelopeDigest } from '@/shared/envelope'

const EMPTY = { merchant: '', faceValue: '', code: '', pin: '', notes: '' }

/** Fulfiller flow. The voucher is encrypted in this tab; only the ciphertext envelope is uploaded. */
export function DeliverForm({ order, onDone }: { order: Order; onDone: () => void }) {
  const { send, phase } = useSend()
  const vault = useVault()
  const [fields, setFields] = useState(EMPTY)
  const [step, setStep] = useState('')
  const set = (k: keyof typeof EMPTY) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [k]: e.target.value }))

  const run = async (e: FormEvent) => {
    e.preventDefault()
    if (!NP_ADDRESS || fields.code.trim() === '') return
    try {
      setStep('Fetching the buyer recipient key')
      const { publicKey } = await api.getRecipient(order.tradeId)
      // The onchain commitment is authoritative: a swapped key from any server is rejected here.
      if (keccak256(publicKey).toLowerCase() !== order.buyerRecipient.toLowerCase()) {
        throw new Error('Recipient key does not match the onchain commitment. Do not deliver.')
      }
      setStep('Encrypting in this browser')
      const envelope = await encryptDelivery(JSON.stringify(toPayload(fields)), order.tradeId, publicKey)
      const digest = envelopeDigest(envelope)
      setStep('Uploading ciphertext only')
      const up = await api.uploadEnvelope(envelope)
      if (up.digest.toLowerCase() !== digest.toLowerCase()) throw new Error('Backend digest mismatch')
      setStep('Requesting validator attestation')
      const att = await api.attest(order.tradeId, digest)
      setStep('')
      const ok = await send({
        address: NP_ADDRESS,
        abi: netPositiveAbi,
        functionName: 'submitDelivery',
        args: [order.tradeId, digest, BigInt(att.expiry), att.signature],
      })
      if (ok) {
        toast.success('Delivery attested and recorded')
        setFields(EMPTY)
        onDone()
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Delivery failed')
    } finally {
      setStep('')
    }
  }

  const fromVault = vault.records
  return (
    <form onSubmit={(e) => void run(e)} className="inner space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold">Deliver voucher</div>
        <div className="flex gap-2">
          <button type="button" className="btn-ghost !min-h-[36px] !px-3 text-xs" onClick={() => setFields({ ...EMPTY, ...syntheticExample() })}>
            Fill synthetic example
          </button>
          {fromVault.length > 0 && (
            <select
              className="field !min-h-[36px] !w-auto text-xs"
              aria-label="Use a vault record"
              value=""
              onChange={(e) => {
                const r = fromVault.find((x) => x.id === e.target.value)
                if (r) setFields({ merchant: r.merchant, faceValue: r.faceValue, code: r.code, pin: r.pin, notes: r.notes })
              }}
            >
              <option value="">From vault...</option>
              {fromVault.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.merchant || 'Record'} {r.faceValue}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2">
        <input className="field" placeholder="Merchant" value={fields.merchant} onChange={set('merchant')} />
        <input className="field tnum" placeholder="Face value" value={fields.faceValue} onChange={set('faceValue')} />
        <input className="field mono col-span-2" placeholder="Voucher code" autoComplete="off" value={fields.code} onChange={set('code')} />
        <input className="field mono" placeholder="PIN (optional)" autoComplete="off" value={fields.pin} onChange={set('pin')} />
        <input className="field" placeholder="Notes" value={fields.notes} onChange={set('notes')} />
      </div>
      <p className="text-xs" style={{ color: 'var(--muted)' }}>
        Use synthetic data in demos. These fields are encrypted to the buyer in this tab and never sent in plaintext to the backend or the chain. The validator attests delivery of an opaque ciphertext, not that the voucher is valid.
      </p>
      <button className="btn-primary w-full" disabled={fields.code.trim() === '' || step !== '' || phase !== 'idle'}>
        {step || (phase === 'wallet' ? 'Confirm in wallet...' : phase === 'confirming' ? 'Waiting for confirmation...' : 'Encrypt, attest and submit')}
      </button>
    </form>
  )
}
