import { isAddress, isHex, hexToBytes, keccak256, type Address, type Hex } from 'viem'
import { attestationTypedData } from '../src/shared/attestation'
import { envelopeDigest, parseEnvelope, PUBKEY_BYTES } from '../src/shared/envelope'
import { verifyOwnership, type OwnershipProof } from '../src/lib/zkOwnership'
import type { Store } from './store'

export const MAX_BODY_BYTES = 24 * 1024
export const ATTESTATION_TTL_SECONDS = 600
const NONCE_TTL_MS = 5 * 60 * 1000
const RATE_LIMIT = 120
const RATE_WINDOW_MS = 60_000

/** Minimal view of an onchain order, as read by the validator before it signs anything. */
export interface ChainOrder {
  state: number
  deliveryDeadline: number
  buyerRecipient: Hex
}

export interface Signer {
  address: Address
  signTypedData: (args: ReturnType<typeof attestationTypedData>) => Promise<Hex>
}

export interface AppDeps {
  store: Store
  chainId: number
  usdc: Address
  contract?: Address
  signer?: Signer
  validator: Address
  readOrder?: (tradeId: Hex) => Promise<ChainOrder>
  now?: () => number
}

const ORDER_OPEN = 1
const isHex32 = (v: unknown): v is Hex => typeof v === 'string' && isHex(v, { strict: true }) && hexToBytes(v).length === 32

class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message)
  }
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' },
  })

async function readJson(req: Request): Promise<unknown> {
  const declared = Number(req.headers.get('content-length') ?? '0')
  if (declared > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large')
  const text = await req.text()
  if (text.length > MAX_BODY_BYTES) throw new HttpError(413, 'Request too large')
  try {
    return JSON.parse(text)
  } catch {
    throw new HttpError(400, 'Body must be JSON')
  }
}

export function createApp(deps: AppDeps): (req: Request) => Promise<Response> {
  const now = deps.now ?? (() => Date.now())
  const hits = new Map<string, { count: number; resetAt: number }>()

  const limited = (req: Request): boolean => {
    const key = req.headers.get('x-forwarded-for') ?? 'local'
    const t = now()
    const entry = hits.get(key)
    if (!entry || entry.resetAt < t) {
      hits.set(key, { count: 1, resetAt: t + RATE_WINDOW_MS })
      return false
    }
    entry.count += 1
    return entry.count > RATE_LIMIT
  }

  async function handle(req: Request): Promise<Response> {
    const url = new URL(req.url)
    const path = url.pathname.replace(/^\/api(?=\/|$)/, '') || '/'
    const method = req.method

    if (method === 'GET' && path === '/health') return json(200, { ok: true })

    if (method === 'GET' && path === '/config') {
      return json(200, {
        chainId: deps.chainId,
        contract: deps.contract ?? null,
        validator: deps.validator,
        validatorConfigured: Boolean(deps.signer),
        usdc: deps.usdc,
      })
    }

    if (method === 'POST' && path === '/envelopes') {
      const env = parseEnvelope(await readJson(req))
      const digest = envelopeDigest(env)
      deps.store.putEnvelope(digest, env)
      return json(201, { digest })
    }

    const envMatch = /^\/envelopes\/(0x[0-9a-fA-F]{64})$/.exec(path)
    if (method === 'GET' && envMatch) {
      const env = deps.store.getEnvelope(envMatch[1] as Hex)
      return env ? json(200, env) : json(404, { error: 'Envelope not found' })
    }

    if (method === 'POST' && path === '/recipients') {
      const body = (await readJson(req)) as { tradeId?: unknown; publicKey?: unknown }
      if (!isHex32(body.tradeId)) throw new HttpError(400, 'Bad tradeId')
      const pub = body.publicKey
      if (typeof pub !== 'string' || !isHex(pub, { strict: true }) || hexToBytes(pub).length !== PUBKEY_BYTES) {
        throw new HttpError(400, 'Bad public key')
      }
      if (!deps.readOrder) throw new HttpError(503, 'Contract not configured')
      const order = await deps.readOrder(body.tradeId)
      if (order.state === 0) throw new HttpError(404, 'Order not found onchain')
      // The onchain commitment is the source of truth. A wrong key is rejected, so this service cannot swap keys.
      if (keccak256(pub).toLowerCase() !== order.buyerRecipient.toLowerCase()) throw new HttpError(400, 'Key does not match the onchain recipient commitment')
      deps.store.putRecipient(body.tradeId, pub)
      return json(201, { ok: true })
    }

    const recMatch = /^\/recipients\/(0x[0-9a-fA-F]{64})$/.exec(path)
    if (method === 'GET' && recMatch) {
      const pub = deps.store.getRecipient(recMatch[1] as Hex)
      return pub ? json(200, { publicKey: pub }) : json(404, { error: 'Recipient key not published' })
    }

    if (method === 'POST' && path === '/attest') {
      if (!deps.signer || !deps.contract || !deps.readOrder) throw new HttpError(503, 'Validator is not configured')
      const body = (await readJson(req)) as { tradeId?: unknown; deliveryDigest?: unknown }
      if (!isHex32(body.tradeId) || !isHex32(body.deliveryDigest)) throw new HttpError(400, 'Bad tradeId or deliveryDigest')
      const env = deps.store.getEnvelope(body.deliveryDigest)
      if (!env) throw new HttpError(404, 'Upload the encrypted envelope first')
      if (env.tradeId.toLowerCase() !== body.tradeId.toLowerCase() || envelopeDigest(env) !== body.deliveryDigest) {
        throw new HttpError(400, 'Envelope does not match this trade or digest')
      }
      const order = await deps.readOrder(body.tradeId)
      if (order.state !== ORDER_OPEN) throw new HttpError(409, 'Order is not awaiting delivery')
      const nowSec = Math.floor(now() / 1000)
      if (order.deliveryDeadline <= nowSec) throw new HttpError(409, 'Delivery deadline has passed')
      if (env.recipientKeyHash.toLowerCase() !== order.buyerRecipient.toLowerCase()) {
        throw new HttpError(409, 'Envelope is not addressed to the buyer recipient committed onchain')
      }
      const expiry = BigInt(nowSec + ATTESTATION_TTL_SECONDS)
      const message = {
        tradeId: body.tradeId,
        deliveryDigest: body.deliveryDigest,
        buyerRecipient: order.buyerRecipient,
        expiry,
      }
      const signature = await deps.signer.signTypedData(attestationTypedData(deps.chainId, deps.contract, message))
      return json(200, { ...message, expiry: expiry.toString(), signature })
    }

    if (method === 'GET' && path === '/ownership/challenge') {
      const nonce = Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, '0')).join('')
      deps.store.issueNonce(nonce, now() + NONCE_TTL_MS)
      return json(200, { nonce, context: `netpositive-ownership:${nonce}` })
    }

    if (method === 'POST' && path === '/ownership/verify') {
      const body = (await readJson(req)) as { commitment?: unknown; proof?: unknown; nonce?: unknown }
      if (typeof body.commitment !== 'string' || typeof body.nonce !== 'string' || typeof body.proof !== 'object' || body.proof === null) {
        throw new HttpError(400, 'Bad request')
      }
      if (!deps.store.consumeNonce(body.nonce, now())) throw new HttpError(400, 'Challenge expired or already used')
      const valid = verifyOwnership(body.commitment as Hex, body.proof as OwnershipProof, `netpositive-ownership:${body.nonce}`)
      return json(200, {
        valid,
        note: 'Proves knowledge of the secret behind this commitment only. It says nothing about whether any voucher is valid, funded or unredeemed.',
      })
    }

    return json(404, { error: 'Not found' })
  }

  return async (req) => {
    try {
      if (limited(req)) return json(429, { error: 'Too many requests' })
      return await handle(req)
    } catch (error) {
      if (error instanceof HttpError) return json(error.status, { error: error.message })
      // parseEnvelope and friends throw plain Errors for malformed input.
      if (error instanceof Error && /^(Envelope|Bad|Unsupported|Ciphertext)/.test(error.message)) {
        return json(400, { error: error.message })
      }
      console.error('request failed', error instanceof Error ? error.name : 'unknown error')
      return json(500, { error: 'Internal error' })
    }
  }
}

export const isConfiguredAddress = (v: string | undefined): v is Address => Boolean(v && isAddress(v))
