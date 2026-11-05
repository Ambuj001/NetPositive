import Fastify from 'fastify'
import cors from '@fastify/cors'
import helmet from '@fastify/helmet'
import rateLimit from '@fastify/rate-limit'
import { DatabaseSync } from 'node:sqlite'
import { createHash, randomBytes } from 'node:crypto'
import { getAddress, verifyMessage } from 'ethers'
import { signRequest } from '@worldcoin/idkit-core/signing'
import { hashSignal } from '@worldcoin/idkit-core/hashing'
import { z } from 'zod'
import { EnvelopeSchema, SharedSchema, digestEnvelope, recipientKeyMessage } from '@netpositive/vault'
import type { FastifyRequest } from 'fastify'

type Config = { database: string, origin: string, world?: { appId: string, rpId: string, signingKey: string, environment: 'staging' | 'production' } }
type Options = { now?: () => number, fetch?: typeof fetch }
const Address = z.string().regex(/^0x[\da-fA-F]{40}$/).transform(v => getAddress(v).toLowerCase())
const tokenHash = (s: string) => createHash('sha256').update(s).digest('hex')
class ApiError extends Error { statusCode: number; constructor(status: number, message: string) { super(message); this.statusCode = status } }

export async function createApp(config: Config, options: Options = {}) {
  const origin = new URL(config.origin)
  if (origin.origin !== config.origin || (!['localhost', '127.0.0.1'].includes(origin.hostname) && origin.protocol !== 'https:')) throw new Error('APP_ORIGIN must be a canonical HTTPS origin')
  const now = options.now ?? Date.now, http = options.fetch ?? fetch
  const app = Fastify({ logger: false, bodyLimit: 20000, requestTimeout: 10000, trustProxy: false })
  await app.register(helmet)
  await app.register(cors, { origin: config.origin, methods: ['GET', 'POST', 'PUT'], credentials: false })
  await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
  app.addHook('onRequest', async (request, reply) => {
    reply.header('Cache-Control', 'no-store')
    if (request.headers.origin && request.headers.origin !== config.origin) throw new ApiError(403, 'Origin refused')
  })
  app.setErrorHandler((error, _req, reply) => {
    const status = error instanceof z.ZodError ? 400 : ((error as {statusCode?: number}).statusCode ?? 500)
    reply.status(status).send({ error: status === 500 ? 'Request failed' : status === 429 ? 'Try again shortly' : error instanceof z.ZodError ? 'Invalid request' : error instanceof Error ? error.message : 'Request refused' })
  })
  const db = new DatabaseSync(config.database)
  db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;
    CREATE TABLE IF NOT EXISTS challenges(address TEXT PRIMARY KEY, message TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS sessions(hash TEXT PRIMARY KEY, address TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS records(id TEXT PRIMARY KEY, owner TEXT NOT NULL, envelope TEXT NOT NULL, digest TEXT NOT NULL, created INTEGER NOT NULL);
    CREATE INDEX IF NOT EXISTS records_owner ON records(owner);
    CREATE TABLE IF NOT EXISTS recipient_keys(owner TEXT PRIMARY KEY, jwk TEXT NOT NULL, signature TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS shares(id TEXT PRIMARY KEY, owner TEXT NOT NULL, recipient TEXT NOT NULL, envelope TEXT NOT NULL);
    CREATE INDEX IF NOT EXISTS shares_recipient ON shares(recipient);
    CREATE TABLE IF NOT EXISTS world_requests(address TEXT PRIMARY KEY, nonce TEXT NOT NULL, expires INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS humans(address TEXT PRIMARY KEY, nullifier TEXT NOT NULL UNIQUE, expires INTEGER NOT NULL, banned INTEGER NOT NULL DEFAULT 0);`)
  app.addHook('onClose', async () => db.close())
  const clean = () => {
    db.prepare('DELETE FROM challenges WHERE expires <= ?').run(now())
    db.prepare('DELETE FROM sessions WHERE expires <= ?').run(now())
    db.prepare('DELETE FROM world_requests WHERE expires <= ?').run(now())
  }
  function auth(req: FastifyRequest) {
    const match = /^Bearer ([0-9a-f]{64})$/.exec(req.headers.authorization ?? '')
    if (!match) throw new ApiError(401, 'Sign in to continue')
    const session = db.prepare('SELECT address FROM sessions WHERE hash=? AND expires>?').get(tokenHash(match[1]), now())
    if (!session) throw new ApiError(401, 'Session expired')
    return session.address as string
  }
  app.get('/health', async () => { db.prepare('SELECT 1').get(); return { status: 'ok', storage: 'ciphertext-only', worldConfigured: !!config.world } })
  app.post('/v1/auth/challenge', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    clean()
    const { address } = z.object({ address: Address }).strict().parse(req.body)
    const expires = now() + 300000
    const message = `${origin.host} wants you to sign in with your Ethereum account:\n${getAddress(address)}\n\nAccess your encrypted NetPositive vault. This signature does not authorize payments.\n\nURI: ${origin.origin}\nVersion: 1\nChain ID: 5042002\nNonce: ${randomBytes(16).toString('hex')}\nIssued At: ${new Date(now()).toISOString()}\nExpiration Time: ${new Date(expires).toISOString()}`
    db.prepare('INSERT OR REPLACE INTO challenges VALUES (?,?,?)').run(address, message, expires)
    return { message }
  })
  app.post('/v1/auth/verify', { config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async req => {
    const { address, signature } = z.object({ address: Address, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict().parse(req.body)
    const row = db.prepare('SELECT message FROM challenges WHERE address=? AND expires>?').get(address, now())
    if (!row) throw new ApiError(401, 'Challenge expired')
    let signer = ''
    try { signer = verifyMessage(row.message as string, signature).toLowerCase() } catch { /* no proof or signature logs */ }
    if (signer !== address) throw new ApiError(401, 'Signature refused')
    // No await between checking and consuming the challenge: single-use on this DB connection.
    db.prepare('DELETE FROM challenges WHERE address=?').run(address)
    db.prepare('DELETE FROM sessions WHERE address=?').run(address)
    const token = randomBytes(32).toString('hex'), expires = now() + 900000
    db.prepare('INSERT INTO sessions VALUES (?,?,?)').run(tokenHash(token), address, expires)
    return { token, expires, address }
  })
  app.post('/v1/auth/logout', async req => {
    auth(req); db.prepare('DELETE FROM sessions WHERE hash=?').run(tokenHash(req.headers.authorization!.slice(7)))
    return { ok: true }
  })
  app.get('/v1/vault', async req => {
    const owner = auth(req)
    return { records: db.prepare('SELECT envelope,digest,created FROM records WHERE owner=? ORDER BY created,id').all(owner).map(r => ({ envelope: JSON.parse(r.envelope as string), digest: r.digest, created: r.created })) }
  })
  app.put('/v1/vault/:id', async req => {
    const owner = auth(req), id = z.object({ id: z.string().uuid() }).parse(req.params).id
    const envelope = EnvelopeSchema.parse(req.body)
    if (envelope.id !== id) throw new ApiError(400, 'Record mismatch')
    const digest = await digestEnvelope(envelope)
    const existing = db.prepare('SELECT owner,digest FROM records WHERE id=?').get(id)
    if (existing) {
      if (existing.owner !== owner || existing.digest !== digest) throw new ApiError(409, 'Immutable record conflict')
      return { id, digest }
    }
    const count = db.prepare('SELECT COUNT(*) as n FROM records WHERE owner=?').get(owner)!.n as number
    if (count >= 500) throw new ApiError(409, 'Vault is full; export a backup')
    db.prepare('INSERT INTO records VALUES (?,?,?,?,?)').run(id, owner, JSON.stringify(envelope), digest, now())
    return { id, digest }
  })
  app.put('/v1/recipient-key', async req => {
    const owner = auth(req)
    const { jwk, signature } = z.object({ jwk: SharedSchema.shape.ephemeral, signature: z.string().regex(/^0x[0-9a-fA-F]{130}$/) }).strict().parse(req.body)
    let signer = ''
    try { signer = verifyMessage(recipientKeyMessage(owner, jwk), signature).toLowerCase() } catch { /* reject below */ }
    if (signer !== owner) throw new ApiError(403, 'Key signature refused')
    // Immutable in v1: replacement needs an explicit versioned key-rotation protocol.
    const old = db.prepare('SELECT jwk FROM recipient_keys WHERE owner=?').get(owner)
    if (old && old.jwk !== JSON.stringify(jwk)) throw new ApiError(409, 'Key rotation requires a new protocol version')
    db.prepare('INSERT OR IGNORE INTO recipient_keys VALUES (?,?,?)').run(owner, JSON.stringify(jwk), signature)
    return { ok: true }
  })
  app.get('/v1/recipient-key/:address', async req => {
    auth(req)
    const { address } = z.object({ address: Address }).parse(req.params)
    const row = db.prepare('SELECT jwk,signature FROM recipient_keys WHERE owner=?').get(address)
    if (!row) throw new ApiError(404, 'Recipient has not registered a key')
    return { jwk: JSON.parse(row.jwk as string), signature: row.signature }
  })
  app.put('/v1/shares/:id', async req => {
    const owner = auth(req), id = z.object({ id: z.string().regex(/^0x[0-9a-f]{64}$/) }).parse(req.params).id
    const envelope = SharedSchema.parse(req.body)
    if (id !== envelope.context.tradeId || envelope.context.recipient === owner) throw new ApiError(400, 'Invalid share context')
    if (!db.prepare('SELECT 1 FROM recipient_keys WHERE owner=?').get(envelope.context.recipient)) throw new ApiError(409, 'Recipient key unavailable')
    if ((db.prepare('SELECT COUNT(*) as n FROM shares WHERE owner=?').get(owner)!.n as number) >= 500) throw new ApiError(409, 'Share limit reached')
    const old = db.prepare('SELECT owner,envelope FROM shares WHERE id=?').get(id)
    if (old && (old.owner !== owner || old.envelope !== JSON.stringify(envelope))) throw new ApiError(409, 'Immutable share conflict')
    db.prepare('INSERT OR IGNORE INTO shares VALUES (?,?,?,?)').run(id, owner, envelope.context.recipient, JSON.stringify(envelope))
    return { id }
  })
  app.get('/v1/shares/:id', async req => {
    const owner = auth(req), id = z.object({ id: z.string().regex(/^0x[0-9a-f]{64}$/) }).parse(req.params).id
    const row = db.prepare('SELECT envelope FROM shares WHERE id=? AND (owner=? OR recipient=?)').get(id, owner, owner)
    if (!row) throw new ApiError(404, 'Share unavailable')
    return { envelope: JSON.parse(row.envelope as string) }
  })
  const action = 'netpositive-trader-v1'
  app.post('/v1/world/request', async req => {
    const address = auth(req), w = config.world
    if (!w) throw new ApiError(503, 'World ID is not configured')
    const rp = signRequest({ signingKeyHex: w.signingKey, action, ttl: 300 })
    db.prepare('INSERT OR REPLACE INTO world_requests VALUES (?,?,?)').run(address, rp.nonce, rp.expiresAt * 1000)
    return { app_id: w.appId, action, environment: w.environment, signal: address,
      rp_context: { rp_id: w.rpId, nonce: rp.nonce, created_at: rp.createdAt, expires_at: rp.expiresAt, signature: rp.sig } }
  })
  app.post('/v1/world/verify', { config: { rateLimit: { max: 5, timeWindow: '1 minute' } } }, async req => {
    const address = auth(req), w = config.world
    if (!w) throw new ApiError(503, 'World ID is not configured')
    const raw = z.object({ protocol_version: z.literal('4.0'), nonce: z.string().min(1).max(100), action: z.literal(action),
      environment: z.literal(w.environment), responses: z.array(z.object({ identifier: z.literal('proof_of_human'),
        signal_hash: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/), proof: z.array(z.string().regex(/^0x[0-9a-fA-F]{1,64}$/)).length(5),
        nullifier: z.string().regex(/^0x[0-9a-fA-F]{1,64}$/), issuer_schema_id: z.literal(1), expires_at_min: z.number().int().positive() }).strict()).length(1) }).strict().parse(req.body)
    const pending = db.prepare('SELECT nonce,expires FROM world_requests WHERE address=?').get(address)
    if (!pending || pending.nonce !== raw.nonce || Number(pending.expires) <= now()) throw new ApiError(403, 'Proof request expired')
    const proof = raw.responses[0]
    if (BigInt(proof.signal_hash) !== BigInt(hashSignal(address)) || proof.expires_at_min * 1000 <= now()) throw new ApiError(403, 'Proof context refused')
    // Forward the complete response unchanged; app/RP, action, environment and signal are server-pinned.
    let verification: {success?: boolean, environment?: string}
    try {
      const response = await http(`https://developer.world.org/api/v4/verify/${encodeURIComponent(w.rpId)}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(raw), signal: AbortSignal.timeout(10000), redirect: 'error' })
      if (!response.ok) throw new Error('Refused')
      verification = await response.json() as typeof verification
    } catch { throw new ApiError(502, 'World verification unavailable or refused') }
    if (verification.success !== true || verification.environment !== w.environment) throw new ApiError(403, 'World proof refused')
    const nullifier = BigInt(proof.nullifier).toString()
    // An upstream call awaited: recheck/consume under a write transaction to close replay races.
    db.exec('BEGIN IMMEDIATE')
    try {
      const fresh = db.prepare('SELECT nonce,expires FROM world_requests WHERE address=?').get(address)
      if (!fresh || fresh.nonce !== raw.nonce || Number(fresh.expires) <= now()) throw new ApiError(403, 'Proof already used or expired')
      const prior = db.prepare('SELECT address,banned FROM humans WHERE nullifier=? OR address=?').all(nullifier, address)
      if (prior.some(p => p.banned || p.address !== address)) throw new ApiError(403, 'Trader verification refused')
      if (prior.length && db.prepare('SELECT nullifier FROM humans WHERE address=?').get(address)?.nullifier !== nullifier) throw new ApiError(403, 'Identity replacement refused')
      db.prepare('INSERT INTO humans VALUES (?,?,?,0) ON CONFLICT(address) DO UPDATE SET expires=excluded.expires').run(address, nullifier, Math.min(proof.expires_at_min * 1000, now() + 86400000))
      db.prepare('DELETE FROM world_requests WHERE address=?').run(address)
      db.exec('COMMIT')
    } catch (e) { db.exec('ROLLBACK'); throw e }
    return { verified: true }
  })
  app.get('/v1/trader', async req => {
    const row = db.prepare('SELECT expires,banned FROM humans WHERE address=?').get(auth(req))
    return { verified: !!row && !row.banned && Number(row.expires) > now() }
  })
  return app
}
