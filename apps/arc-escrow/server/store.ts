import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'
import type { Hex } from 'viem'
import type { DeliveryEnvelope } from '../src/shared/envelope'

interface Snapshot {
  envelopes: Record<string, DeliveryEnvelope>
  recipients: Record<string, Hex>
}

/**
 * Tiny JSON-file store. It holds ONLY client-encrypted envelopes (ciphertext), buyer public keys,
 * and short-lived proof nonces (memory only). There is no table, field, or log for voucher plaintext.
 */
export class Store {
  private envelopes = new Map<string, DeliveryEnvelope>()
  private recipients = new Map<string, Hex>()
  private nonces = new Map<string, number>()

  constructor(private readonly file?: string) {
    if (file && existsSync(file)) {
      try {
        const snap = JSON.parse(readFileSync(file, 'utf8')) as Snapshot
        for (const [k, v] of Object.entries(snap.envelopes ?? {})) this.envelopes.set(k, v)
        for (const [k, v] of Object.entries(snap.recipients ?? {})) this.recipients.set(k, v)
      } catch {
        // A corrupt cache must not stop the service; ciphertext is re-uploadable by the fulfiller.
      }
    }
  }

  private persist(): void {
    if (!this.file) return
    mkdirSync(dirname(this.file), { recursive: true })
    const snap: Snapshot = {
      envelopes: Object.fromEntries(this.envelopes),
      recipients: Object.fromEntries(this.recipients),
    }
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(snap))
    renameSync(tmp, this.file)
  }

  putEnvelope(digest: Hex, env: DeliveryEnvelope): void {
    this.envelopes.set(digest.toLowerCase(), env)
    this.persist()
  }
  getEnvelope(digest: Hex): DeliveryEnvelope | undefined {
    return this.envelopes.get(digest.toLowerCase())
  }
  putRecipient(tradeId: Hex, publicKey: Hex): void {
    this.recipients.set(tradeId.toLowerCase(), publicKey)
    this.persist()
  }
  getRecipient(tradeId: Hex): Hex | undefined {
    return this.recipients.get(tradeId.toLowerCase())
  }

  issueNonce(nonce: string, expiresAtMs: number): void {
    this.nonces.set(nonce, expiresAtMs)
    if (this.nonces.size > 5000) {
      const now = Date.now()
      for (const [k, exp] of this.nonces) if (exp < now) this.nonces.delete(k)
    }
  }
  /** Single use: returns true once, then false. */
  consumeNonce(nonce: string, nowMs: number): boolean {
    const exp = this.nonces.get(nonce)
    this.nonces.delete(nonce)
    return exp !== undefined && exp >= nowMs
  }
}
