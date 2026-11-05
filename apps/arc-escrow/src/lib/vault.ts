/**
 * Vault data model and persistence. The decrypted vault only ever exists in memory while unlocked;
 * at rest it is a single AES-256-GCM blob in localStorage under a passphrase-derived key.
 */
import type { Hex } from 'viem'
import {
  decryptWithPassphrase,
  encryptWithPassphrase,
  type EncryptedBlob,
  type RecipientKey,
} from './crypto'
import { newOwnershipKeypair } from './zkOwnership'

export const VAULT_STORAGE_KEY = 'netpositive.vault.v1'
export const MIN_PASSPHRASE_LENGTH = 12

export interface VaultRecord {
  id: string
  merchant: string
  faceValue: string
  code: string
  pin: string
  notes: string
  createdAt: number
  source: 'manual' | 'delivery' | 'synthetic'
  tradeId?: Hex
  /** Secret behind the ZK ownership commitment. */
  ownershipSecret: Hex
  ownershipCommitment: Hex
}

export interface VaultRecipientKey extends RecipientKey {
  tradeId: Hex
  createdAt: number
}

export interface VaultData {
  version: 1
  records: VaultRecord[]
  recipientKeys: VaultRecipientKey[]
}

export const emptyVault = (): VaultData => ({ version: 1, records: [], recipientKeys: [] })

export function parseVaultData(json: string): VaultData {
  const data = JSON.parse(json) as Partial<VaultData>
  if (data.version !== 1 || !Array.isArray(data.records) || !Array.isArray(data.recipientKeys)) {
    throw new Error('Not a NetPositive vault')
  }
  return data as VaultData
}

export function hasStoredVault(): boolean {
  return localStorage.getItem(VAULT_STORAGE_KEY) !== null
}

export async function saveVault(data: VaultData, passphrase: string): Promise<void> {
  const blob = await encryptWithPassphrase(JSON.stringify(data), passphrase, 'vault')
  localStorage.setItem(VAULT_STORAGE_KEY, JSON.stringify(blob))
}

export async function openStoredVault(passphrase: string): Promise<VaultData> {
  const raw = localStorage.getItem(VAULT_STORAGE_KEY)
  if (!raw) throw new Error('No vault found on this device')
  return parseVaultData(await decryptWithPassphrase(JSON.parse(raw) as EncryptedBlob, passphrase))
}

export function wipeStoredVault(): void {
  localStorage.removeItem(VAULT_STORAGE_KEY)
}

/** Encrypted recovery export under a separate passphrase. The file contains no plaintext. */
export async function buildRecoveryExport(data: VaultData, recoveryPassphrase: string): Promise<EncryptedBlob> {
  return encryptWithPassphrase(JSON.stringify(data), recoveryPassphrase, 'recovery')
}

export async function readRecoveryExport(fileText: string, recoveryPassphrase: string): Promise<VaultData> {
  const blob = JSON.parse(fileText) as EncryptedBlob
  if (blob.kind !== 'recovery') throw new Error('This is not a recovery export')
  return parseVaultData(await decryptWithPassphrase(blob, recoveryPassphrase))
}

export function newRecord(
  fields: Pick<VaultRecord, 'merchant' | 'faceValue' | 'code' | 'pin' | 'notes'> &
    Partial<Pick<VaultRecord, 'source' | 'tradeId'>>,
): VaultRecord {
  const own = newOwnershipKeypair()
  return {
    id: crypto.randomUUID(),
    createdAt: Date.now(),
    source: fields.source ?? 'manual',
    tradeId: fields.tradeId,
    merchant: fields.merchant,
    faceValue: fields.faceValue,
    code: fields.code,
    pin: fields.pin,
    notes: fields.notes,
    ownershipSecret: own.secret,
    ownershipCommitment: own.commitment,
  }
}

/** Obviously fake values. Never put real card data into examples. */
export const syntheticExample = (): Pick<VaultRecord, 'merchant' | 'faceValue' | 'code' | 'pin' | 'notes'> => ({
  merchant: 'Synthetic Coffee Co (demo)',
  faceValue: '25.00',
  code: 'SYNTH-0000-0000-0000',
  pin: '0000',
  notes: 'Synthetic example. Not a real voucher.',
})

/** The plaintext payload a fulfiller encrypts. It is built and encrypted in the browser only. */
export interface VoucherPayload {
  schema: 'np-voucher/1'
  merchant: string
  faceValue: string
  code: string
  pin: string
  notes: string
}

export const toPayload = (r: Pick<VaultRecord, 'merchant' | 'faceValue' | 'code' | 'pin' | 'notes'>): VoucherPayload => ({
  schema: 'np-voucher/1',
  merchant: r.merchant,
  faceValue: r.faceValue,
  code: r.code,
  pin: r.pin,
  notes: r.notes,
})

export function parsePayload(json: string): VoucherPayload {
  const p = JSON.parse(json) as Partial<VoucherPayload>
  if (p.schema !== 'np-voucher/1' || typeof p.code !== 'string') throw new Error('Unrecognized voucher payload')
  return {
    schema: 'np-voucher/1',
    merchant: String(p.merchant ?? ''),
    faceValue: String(p.faceValue ?? ''),
    code: p.code,
    pin: String(p.pin ?? ''),
    notes: String(p.notes ?? ''),
  }
}
