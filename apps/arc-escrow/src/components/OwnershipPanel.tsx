import { useState } from 'react'
import { BadgeCheck } from 'lucide-react'
import { toast } from 'sonner'
import { api } from '@/lib/api'
import { shortHex } from '@/lib/netpositive'
import type { VaultRecord } from '@/lib/vault'
import { proveOwnership, verifyOwnership } from '@/lib/zkOwnership'

/** Zero-knowledge proof that you know the secret behind a record's commitment. It proves nothing about the voucher. */
export function OwnershipPanel({ record }: { record: VaultRecord }) {
  const [result, setResult] = useState<string>()
  const [busy, setBusy] = useState(false)

  const prove = async () => {
    setBusy(true)
    try {
      const { nonce, context } = await api.ownershipChallenge()
      const proof = proveOwnership(record.ownershipSecret, context)
      if (!verifyOwnership(record.ownershipCommitment, proof, context)) throw new Error('Local self-check failed')
      const res = await api.verifyOwnership(record.ownershipCommitment, proof, nonce)
      setResult(res.valid ? 'Verified: you know the record secret.' : 'Verifier rejected the proof.')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Proof failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-xl bg-white/70 p-3 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span>
          <span className="label">Commitment</span> <span className="mono">{shortHex(record.ownershipCommitment, 10, 6)}</span>
        </span>
        <button className="btn-ghost !min-h-[36px] !px-3 text-xs" onClick={() => void prove()} disabled={busy}>
          <BadgeCheck size={14} /> {busy ? 'Proving...' : 'Prove ownership'}
        </button>
      </div>
      {result && <p role="status" style={{ color: 'var(--success)' }}>{result}</p>}
      <p style={{ color: 'var(--muted)' }}>
        This proves knowledge of a secret only. It does not prove the voucher is real, funded, or unspent, because anyone can commit to a random secret.
      </p>
    </div>
  )
}
