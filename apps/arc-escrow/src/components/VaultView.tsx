import { useRef, useState, type FormEvent } from 'react'
import { Download, Eye, EyeOff, Lock, Trash2, Upload } from 'lucide-react'
import { toast } from 'sonner'
import { useVault } from '@/hooks/useVault'
import { MIN_PASSPHRASE_LENGTH, syntheticExample, type VaultRecord } from '@/lib/vault'
import { OwnershipPanel } from './OwnershipPanel'
import { VaultGate } from './VaultGate'

const BLANK = { merchant: '', faceValue: '', code: '', pin: '', notes: '' }

function RecordRow({ record }: { record: VaultRecord }) {
  const vault = useVault()
  const [shown, setShown] = useState(false)
  return (
    <li className="inner space-y-2">
      <div className="flex items-start justify-between gap-2">
        <div>
          <div className="font-semibold">{record.merchant || 'Untitled voucher'}</div>
          <div className="text-xs tnum" style={{ color: 'var(--muted)' }}>
            {record.faceValue || 'No value'} - {record.source} - {new Date(record.createdAt).toLocaleDateString()}
          </div>
        </div>
        <div className="flex gap-1">
          <button className="btn-ghost !min-h-[40px] !px-2" aria-label={shown ? 'Hide code' : 'Reveal code'} onClick={() => setShown((s) => !s)}>
            {shown ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
          <button className="btn-danger !min-h-[40px] !px-2" aria-label="Delete record" onClick={() => void vault.removeRecord(record.id)}>
            <Trash2 size={16} />
          </button>
        </div>
      </div>
      <div className="mono break-all rounded-xl bg-white/80 p-3 text-sm">
        {shown ? record.code : '•••• •••• •••• ••••'}
        {shown && record.pin && <span className="ml-3">PIN {record.pin}</span>}
      </div>
      {shown && record.notes && <p className="text-xs" style={{ color: 'var(--muted)' }}>{record.notes}</p>}
      <OwnershipPanel record={record} />
    </li>
  )
}

export function VaultView() {
  const vault = useVault()
  const [fields, setFields] = useState(BLANK)
  const [recoveryPass, setRecoveryPass] = useState('')
  const fileRef = useRef<HTMLInputElement>(null)
  const set = (k: keyof typeof BLANK) => (e: { target: { value: string } }) => setFields((f) => ({ ...f, [k]: e.target.value }))

  const add = async (e: FormEvent) => {
    e.preventDefault()
    if (fields.code.trim() === '') return
    await vault.addRecord(fields)
    setFields(BLANK)
    toast.success('Encrypted and saved')
  }

  const exportRecovery = async () => {
    try {
      const text = await vault.exportRecovery(recoveryPass)
      const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
      const a = document.createElement('a')
      a.href = url
      a.download = `netpositive-recovery-${new Date().toISOString().slice(0, 10)}.npvault`
      a.click()
      URL.revokeObjectURL(url)
      toast.success('Encrypted recovery file downloaded')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Export failed')
    }
  }

  const importRecovery = async (file: File) => {
    try {
      await vault.importRecovery(await file.text(), recoveryPass)
      toast.success('Recovery file merged into your vault')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Import failed')
    }
  }

  if (!vault.unlocked) {
    return (
      <div className="mx-auto max-w-md space-y-3">
        <section className="card space-y-3">
          <h2 className="display text-xl font-semibold">Private gift-card vault</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Records are encrypted in your browser with AES-256-GCM under a key derived from your passphrase. The backend and the chain never see them.
          </p>
          <VaultGate reason="Your records and order keys live here." />
          {vault.exists && (
            <button
              className="btn-danger w-full"
              onClick={() => window.confirm('Erase the encrypted vault from this device? This cannot be undone without a recovery file.') && vault.wipe()}
            >
              Erase vault from this device
            </button>
          )}
        </section>
      </div>
    )
  }

  return (
    <div className="grid gap-4 lg:grid-cols-[minmax(0,420px)_1fr]">
      <div className="space-y-4">
        <form onSubmit={(e) => void add(e)} className="card space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="display text-xl font-semibold">Add a record</h2>
            <button type="button" className="btn-ghost !min-h-[36px] !px-3 text-xs" onClick={() => setFields({ ...BLANK, ...syntheticExample() })}>
              Synthetic example
            </button>
          </div>
          <input className="field" placeholder="Merchant" value={fields.merchant} onChange={set('merchant')} />
          <div className="grid grid-cols-2 gap-2">
            <input className="field tnum" placeholder="Face value" value={fields.faceValue} onChange={set('faceValue')} />
            <input className="field mono" placeholder="PIN (optional)" autoComplete="off" value={fields.pin} onChange={set('pin')} />
          </div>
          <input className="field mono" placeholder="Voucher code" autoComplete="off" value={fields.code} onChange={set('code')} />
          <input className="field" placeholder="Notes" value={fields.notes} onChange={set('notes')} />
          <button className="btn-primary w-full" disabled={fields.code.trim() === ''}>Encrypt and save</button>
        </form>

        <section className="card space-y-3">
          <h2 className="display text-xl font-semibold">Encrypted recovery</h2>
          <p className="text-sm" style={{ color: 'var(--muted)' }}>
            Export your vault under a separate recovery passphrase. The file is ciphertext only. Without the passphrase it cannot be read, and there is no reset.
          </p>
          <input className="field" type="password" autoComplete="off" placeholder={`Recovery passphrase (${MIN_PASSPHRASE_LENGTH}+ characters)`} value={recoveryPass} onChange={(e) => setRecoveryPass(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <button className="btn-ghost" onClick={() => void exportRecovery()} disabled={recoveryPass.length < MIN_PASSPHRASE_LENGTH}>
              <Download size={16} /> Export
            </button>
            <button className="btn-ghost" onClick={() => fileRef.current?.click()} disabled={recoveryPass.length < MIN_PASSPHRASE_LENGTH}>
              <Upload size={16} /> Import
            </button>
            <input
              ref={fileRef}
              type="file"
              accept=".npvault,application/json"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void importRecovery(f)
                e.target.value = ''
              }}
            />
          </div>
          <button className="btn-ghost w-full" onClick={vault.lock}><Lock size={16} /> Lock now</button>
        </section>
      </div>

      <section className="space-y-3" aria-labelledby="records-title">
        <h2 id="records-title" className="display text-xl font-semibold">Records ({vault.records.length})</h2>
        {vault.records.length === 0 ? (
          <div className="card text-sm" style={{ color: 'var(--muted)' }}>No records yet. Add a synthetic example to try the vault, or receive a delivery from an order.</div>
        ) : (
          <ul className="space-y-3">{vault.records.map((r) => <RecordRow key={r.id} record={r} />)}</ul>
        )}
        <p className="text-xs" style={{ color: 'var(--muted)' }}>
          The vault locks itself after 10 minutes. Keys for {vault.recipientKeys.length} order(s) are stored inside it.
        </p>
      </section>
    </div>
  )
}
