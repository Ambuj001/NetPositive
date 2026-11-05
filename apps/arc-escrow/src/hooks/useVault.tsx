import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Hex } from 'viem'
import {
  MIN_PASSPHRASE_LENGTH,
  buildRecoveryExport,
  emptyVault,
  hasStoredVault,
  newRecord,
  openStoredVault,
  readRecoveryExport,
  saveVault,
  wipeStoredVault,
  type VaultData,
  type VaultRecord,
  type VaultRecipientKey,
} from '@/lib/vault'
import type { RecipientKey } from '@/lib/crypto'

const AUTO_LOCK_MS = 10 * 60 * 1000

interface VaultApi {
  exists: boolean
  unlocked: boolean
  records: VaultRecord[]
  recipientKeys: VaultRecipientKey[]
  create: (passphrase: string) => Promise<void>
  unlock: (passphrase: string) => Promise<void>
  lock: () => void
  wipe: () => void
  addRecord: (fields: Parameters<typeof newRecord>[0]) => Promise<VaultRecord>
  removeRecord: (id: string) => Promise<void>
  addRecipientKey: (tradeId: Hex, key: RecipientKey) => Promise<void>
  findRecipientKey: (tradeId: Hex) => VaultRecipientKey | undefined
  exportRecovery: (recoveryPassphrase: string) => Promise<string>
  importRecovery: (fileText: string, recoveryPassphrase: string) => Promise<void>
}

const VaultContext = createContext<VaultApi | null>(null)

export function VaultProvider({ children }: { children: ReactNode }) {
  const [exists, setExists] = useState(hasStoredVault())
  const [data, setData] = useState<VaultData | null>(null)
  // The passphrase is held in memory only while unlocked, so edits can be re-encrypted.
  const passphraseRef = useRef<string | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)

  const lock = useCallback(() => {
    passphraseRef.current = null
    setData(null)
  }, [])

  const touch = useCallback(() => {
    clearTimeout(timer.current)
    timer.current = setTimeout(lock, AUTO_LOCK_MS)
  }, [lock])

  useEffect(() => () => clearTimeout(timer.current), [])

  const persist = useCallback(
    async (next: VaultData) => {
      const pass = passphraseRef.current
      if (!pass) throw new Error('Vault is locked')
      await saveVault(next, pass)
      setData(next)
      touch()
    },
    [touch],
  )

  const requireData = (): VaultData => {
    if (!data) throw new Error('Unlock the vault first')
    return data
  }

  const api = useMemo<VaultApi>(
    () => ({
      exists,
      unlocked: data !== null,
      records: data?.records ?? [],
      recipientKeys: data?.recipientKeys ?? [],
      create: async (passphrase) => {
        if (passphrase.length < MIN_PASSPHRASE_LENGTH) {
          throw new Error(`Use a passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters`)
        }
        const fresh = emptyVault()
        await saveVault(fresh, passphrase)
        passphraseRef.current = passphrase
        setExists(true)
        setData(fresh)
        touch()
      },
      unlock: async (passphrase) => {
        const opened = await openStoredVault(passphrase)
        passphraseRef.current = passphrase
        setData(opened)
        touch()
      },
      lock,
      wipe: () => {
        wipeStoredVault()
        lock()
        setExists(false)
      },
      addRecord: async (fields) => {
        const current = requireData()
        const record = newRecord(fields)
        await persist({ ...current, records: [record, ...current.records] })
        return record
      },
      removeRecord: async (id) => {
        const current = requireData()
        await persist({ ...current, records: current.records.filter((r) => r.id !== id) })
      },
      addRecipientKey: async (tradeId, key) => {
        const current = requireData()
        const entry: VaultRecipientKey = { ...key, tradeId, createdAt: Date.now() }
        await persist({ ...current, recipientKeys: [entry, ...current.recipientKeys] })
      },
      findRecipientKey: (tradeId) =>
        data?.recipientKeys.find((k) => k.tradeId.toLowerCase() === tradeId.toLowerCase()),
      exportRecovery: async (recoveryPassphrase) => {
        const current = requireData()
        if (recoveryPassphrase.length < MIN_PASSPHRASE_LENGTH) {
          throw new Error(`Use a recovery passphrase of at least ${MIN_PASSPHRASE_LENGTH} characters`)
        }
        return JSON.stringify(await buildRecoveryExport(current, recoveryPassphrase), null, 2)
      },
      importRecovery: async (fileText, recoveryPassphrase) => {
        const restored = await readRecoveryExport(fileText, recoveryPassphrase)
        const pass = passphraseRef.current
        if (!pass) throw new Error('Unlock or create a vault first, then import')
        const current = requireData()
        const ids = new Set(current.records.map((r) => r.id))
        const keys = new Set(current.recipientKeys.map((k) => k.tradeId))
        await persist({
          version: 1,
          records: [...current.records, ...restored.records.filter((r) => !ids.has(r.id))],
          recipientKeys: [...current.recipientKeys, ...restored.recipientKeys.filter((k) => !keys.has(k.tradeId))],
        })
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [exists, data, lock, persist, touch],
  )

  return <VaultContext.Provider value={api}>{children}</VaultContext.Provider>
}

export function useVault(): VaultApi {
  const ctx = useContext(VaultContext)
  if (!ctx) throw new Error('useVault must be used inside VaultProvider')
  return ctx
}
