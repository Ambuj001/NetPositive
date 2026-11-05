import type { Address, Hex } from 'viem'
import type { DeliveryEnvelope } from '@/shared/envelope'
import type { OwnershipProof } from '@/lib/zkOwnership'

/** The backend is reached through the Vite proxy at /api. It only ever receives ciphertext, public keys and proofs. */
async function call<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api${path}`, {
    ...init,
    headers: { 'content-type': 'application/json', ...(init?.headers ?? {}) },
  })
  const body = (await res.json().catch(() => ({}))) as { error?: string } & T
  if (!res.ok) throw new Error(body.error ?? `Backend error ${res.status}`)
  return body
}

export interface BackendConfig {
  chainId: number
  contract: Address | null
  validator: Address
  validatorConfigured: boolean
  usdc: Address
}

export interface SignedAttestation {
  tradeId: Hex
  deliveryDigest: Hex
  buyerRecipient: Hex
  expiry: string
  signature: Hex
}

export const api = {
  config: () => call<BackendConfig>('/config'),
  publishRecipient: (tradeId: Hex, publicKey: Hex) =>
    call<{ ok: true }>('/recipients', { method: 'POST', body: JSON.stringify({ tradeId, publicKey }) }),
  getRecipient: (tradeId: Hex) => call<{ publicKey: Hex }>(`/recipients/${tradeId}`),
  uploadEnvelope: (envelope: DeliveryEnvelope) =>
    call<{ digest: Hex }>('/envelopes', { method: 'POST', body: JSON.stringify(envelope) }),
  getEnvelope: (digest: Hex) => call<DeliveryEnvelope>(`/envelopes/${digest}`),
  attest: (tradeId: Hex, deliveryDigest: Hex) =>
    call<SignedAttestation>('/attest', { method: 'POST', body: JSON.stringify({ tradeId, deliveryDigest }) }),
  ownershipChallenge: () => call<{ nonce: string; context: string }>('/ownership/challenge'),
  verifyOwnership: (commitment: Hex, proof: OwnershipProof, nonce: string) =>
    call<{ valid: boolean; note: string }>('/ownership/verify', {
      method: 'POST',
      body: JSON.stringify({ commitment, proof, nonce }),
    }),
}
