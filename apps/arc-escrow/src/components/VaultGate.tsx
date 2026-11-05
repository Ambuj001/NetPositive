import { useState, type FormEvent } from 'react'
import { Lock, LockOpen } from 'lucide-react'
import { toast } from 'sonner'
import { useVault } from '@/hooks/useVault'
import { MIN_PASSPHRASE_LENGTH } from '@/lib/vault'

/** Inline create/unlock prompt. The passphrase never leaves the tab and is never sent to the backend. */
export function VaultGate({ reason }: { reason: string }) {
  const vault = useVault()
  const [pass, setPass] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const creating = !vault.exists

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (creating && pass !== confirm) {
      toast.error('Passphrases do not match')
      return
    }
    setBusy(true)
    try {
      if (creating) await vault.create(pass)
      else await vault.unlock(pass)
      setPass('')
      setConfirm('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Could not open vault')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="inner space-y-3">
      <div className="flex items-center gap-2 text-sm font-semibold">
        {creating ? <LockOpen size={16} /> : <Lock size={16} />}
        {creating ? 'Create your private vault' : 'Unlock your vault'}
      </div>
      <p className="text-sm" style={{ color: 'var(--muted)' }}>
        {reason} Encryption happens in this browser tab (AES-256-GCM, PBKDF2 key). Nothing is sent to the backend.
      </p>
      <input
        className="field"
        type="password"
        autoComplete={creating ? 'new-password' : 'current-password'}
        placeholder={creating ? `Passphrase (${MIN_PASSPHRASE_LENGTH}+ characters)` : 'Vault passphrase'}
        value={pass}
        onChange={(e) => setPass(e.target.value)}
        aria-label="Vault passphrase"
      />
      {creating && (
        <input
          className="field"
          type="password"
          autoComplete="new-password"
          placeholder="Repeat passphrase"
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          aria-label="Repeat vault passphrase"
        />
      )}
      {creating && (
        <p className="text-xs" style={{ color: 'var(--warn)' }}>
          There is no passphrase reset. Make an encrypted recovery export after you add records.
        </p>
      )}
      <button className="btn-primary w-full" disabled={busy || pass.length === 0}>
        {busy ? 'Deriving key...' : creating ? 'Create vault' : 'Unlock'}
      </button>
    </form>
  )
}
