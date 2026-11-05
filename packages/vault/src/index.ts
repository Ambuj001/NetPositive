import { z } from 'zod'

export const FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n
const text = new TextEncoder()
const decode = new TextDecoder('utf-8', { fatal: true })
const short = z.string().trim().min(1).max(80)
// An allowlist, rather than arbitrary JSON, keeps payment credentials out of this API.
export const RecordSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('gift-card'), brand: short, code: z.string().min(1).max(512),
    redemptionPin: z.string().max(32).optional(), valueMinor: z.number().int().positive().max(1e12),
    currency: z.string().regex(/^[A-Z]{3}$/), expires: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional() }).strict(),
  z.object({ kind: z.literal('payment-card'), issuer: short, variant: short,
    network: z.enum(['Visa', 'Mastercard', 'RuPay', 'Amex', 'Other']), last4: z.string().regex(/^\d{4}$/) }).strict(),
])
export type VaultRecord = z.infer<typeof RecordSchema>
export const EnvelopeSchema = z.object({
  version: z.literal(1), id: z.string().uuid(),
  iv: z.string().regex(/^[0-9a-f]{24}$/),
  ciphertext: z.string().regex(/^[0-9a-f]{8224}$/), // 4096 padded bytes + 16-byte GCM tag
}).strict()
export type Envelope = z.infer<typeof EnvelopeSchema>
export function hex(bytes: ArrayBuffer | Uint8Array): string {
  return Array.from(new Uint8Array(bytes instanceof Uint8Array ? bytes : bytes)).map(b => b.toString(16).padStart(2, '0')).join('')
}
export function unhex(value: string): Uint8Array<ArrayBuffer> {
  if (!/^(?:[0-9a-f]{2})+$/.test(value)) throw new Error('Invalid bytes')
  return Uint8Array.from(value.match(/../g)!, h => parseInt(h, 16))
}
export const newKey = () => crypto.getRandomValues(new Uint8Array(32))
const aad = (id: string) => text.encode(`NetPositive:record:v1:${id}`)
async function derive(master: Uint8Array<ArrayBuffer>, id: string, purpose: string) {
  if (master.byteLength !== 32) throw new Error('Expected a 32-byte vault key')
  const material = await crypto.subtle.importKey('raw', master, 'HKDF', false, ['deriveBits'])
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'HKDF', hash: 'SHA-256', salt: text.encode(id), info: text.encode(`NetPositive:v1:${purpose}`) }, material, 256))
}
async function recordKey(master: Uint8Array<ArrayBuffer>, id: string) {
  return crypto.subtle.importKey('raw', await derive(master, id, 'encryption'), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
function pack(record: VaultRecord): Uint8Array<ArrayBuffer> {
  const bytes = text.encode(JSON.stringify(RecordSchema.parse(record)))
  if (bytes.length > 4092) throw new Error('Record too large')
  const padded = crypto.getRandomValues(new Uint8Array(4096))
  new DataView(padded.buffer).setUint32(0, bytes.length)
  padded.set(bytes, 4)
  return padded
}
function unpack(bytes: ArrayBuffer): VaultRecord {
  if (bytes.byteLength !== 4096) throw new Error('Invalid record size')
  const length = new DataView(bytes).getUint32(0)
  if (length > 4092) throw new Error('Invalid record')
  return RecordSchema.parse(JSON.parse(decode.decode(new Uint8Array(bytes, 4, length))))
}
export async function encryptRecord(master: Uint8Array<ArrayBuffer>, record: VaultRecord): Promise<Envelope> {
  const id = crypto.randomUUID()
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: aad(id) }, await recordKey(master, id), pack(record))
  return { version: 1, id, iv: hex(iv), ciphertext: hex(ciphertext) }
}
export async function decryptRecord(master: Uint8Array<ArrayBuffer>, input: Envelope): Promise<VaultRecord> {
  const e = EnvelopeSchema.parse(input)
  return unpack(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(e.iv), additionalData: aad(e.id) }, await recordKey(master, e.id), unhex(e.ciphertext)))
}
export async function digestEnvelope(input: Envelope): Promise<string> {
  const e = EnvelopeSchema.parse(input)
  return hex(await crypto.subtle.digest('SHA-256', text.encode(JSON.stringify([e.version, e.id, e.iv, e.ciphertext]))))
}
export async function proofInput(master: Uint8Array<ArrayBuffer>, e: Envelope, owner: string, scope: bigint) {
  if (!/^0x[0-9a-fA-F]{40}$/.test(owner) || scope < 0n || scope >= FIELD) throw new Error('Invalid proof context')
  return { secret: ((BigInt('0x' + hex(await derive(master, e.id, 'proof-secret'))) % (FIELD - 1n)) + 1n).toString(),
    salt: (BigInt('0x' + hex(await derive(master, e.id, 'proof-salt'))) % FIELD).toString(),
    digest: (BigInt('0x' + await digestEnvelope(e)) % FIELD).toString(), owner: BigInt(owner).toString(), scope: scope.toString() }
}
const BackupSchema = z.object({ version: z.literal(1), salt: z.string().regex(/^[0-9a-f]{32}$/),
  iv: z.string().regex(/^[0-9a-f]{24}$/), ciphertext: z.string().regex(/^(?:[0-9a-f]{2}){16,5000000}$/) }).strict()
async function backupKey(passphrase: string, salt: Uint8Array<ArrayBuffer>) {
  if (passphrase.length < 16 || passphrase.length > 1024) throw new Error('Use a unique recovery passphrase of at least 16 characters')
  const key = await crypto.subtle.importKey('raw', text.encode(passphrase), 'PBKDF2', false, ['deriveKey'])
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', iterations: 600000, salt }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'])
}
export async function exportBackup(master: Uint8Array<ArrayBuffer>, envelopes: Envelope[], passphrase: string) {
  if (master.length !== 32 || envelopes.length > 500) throw new Error('Invalid backup')
  const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12))
  const payload = text.encode(JSON.stringify({ key: hex(master), envelopes: envelopes.map(e => EnvelopeSchema.parse(e)) }))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode('NetPositive:backup:v1') }, await backupKey(passphrase, salt), payload)
  return { version: 1 as const, salt: hex(salt), iv: hex(iv), ciphertext: hex(ciphertext) }
}
export async function importBackup(input: unknown, passphrase: string) {
  const b = BackupSchema.parse(input)
  const raw = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(b.iv), additionalData: text.encode('NetPositive:backup:v1') }, await backupKey(passphrase, unhex(b.salt)), unhex(b.ciphertext))
  const payload = z.object({ key: z.string().regex(/^[0-9a-f]{64}$/), envelopes: z.array(EnvelopeSchema).max(500) }).strict().parse(JSON.parse(decode.decode(raw)))
  const key = unhex(payload.key)
  // Detect mismatched keys or corrupted records before replacing any existing vault.
  await Promise.all(payload.envelopes.map(e => decryptRecord(key, e)))
  return { key, envelopes: payload.envelopes }
}

// Public keys must be authenticated against the recipient wallet outside this function.
export const createRecipientKeys = () => crypto.subtle.generateKey({ name: 'ECDH', namedCurve: 'P-256' }, false, ['deriveBits'])
const ShareContext = z.object({ tradeId: z.string().regex(/^0x[0-9a-f]{64}$/), recipient: z.string().regex(/^0x[0-9a-f]{40}$/) }).strict()
const PublicKeySchema = z.object({ kty: z.literal('EC'), crv: z.literal('P-256'), x: z.string().regex(/^[\w-]{43}$/), y: z.string().regex(/^[\w-]{43}$/) }).strict()
export async function publicRecipientKey(key: CryptoKey) {
  const jwk = await crypto.subtle.exportKey('jwk', key)
  return PublicKeySchema.parse({ kty: jwk.kty, crv: jwk.crv, x: jwk.x, y: jwk.y })
}
export function recipientKeyMessage(wallet: string, jwk: unknown) {
  return `NetPositive recipient key v1\nWallet: ${wallet.toLowerCase()}\nKey: ${JSON.stringify(PublicKeySchema.parse(jwk))}\nPurpose: receive encrypted vouchers; no payment authorization.`
}
async function sharedKey(privateKey: CryptoKey, publicJwk: unknown, context: {tradeId: string, recipient: string}) {
  const pub = await crypto.subtle.importKey('jwk', PublicKeySchema.parse(publicJwk), { name: 'ECDH', namedCurve: 'P-256' }, false, [])
  const bits = await crypto.subtle.deriveBits({ name: 'ECDH', public: pub }, privateKey, 256)
  return crypto.subtle.importKey('raw', await derive(new Uint8Array(bits), context.tradeId, `share:${context.recipient}`), 'AES-GCM', false, ['encrypt', 'decrypt'])
}
export const SharedSchema = z.object({ version: z.literal(1), context: ShareContext, ephemeral: PublicKeySchema,
  iv: z.string().regex(/^[0-9a-f]{24}$/), ciphertext: z.string().regex(/^[0-9a-f]{8224}$/) }).strict()
export async function sealForRecipient(record: VaultRecord, recipientPublicKey: unknown, rawContext: z.infer<typeof ShareContext>) {
  const context = ShareContext.parse(rawContext), ephemeral = await createRecipientKeys()
  if (RecordSchema.parse(record).kind !== 'gift-card') throw new Error('Payment-card records cannot be shared')
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: text.encode(JSON.stringify(context)) }, await sharedKey(ephemeral.privateKey, recipientPublicKey, context), pack(record))
  return { version: 1 as const, context, ephemeral: await publicRecipientKey(ephemeral.publicKey), iv: hex(iv), ciphertext: hex(ciphertext) }
}
export async function openShared(input: unknown, recipientPrivateKey: CryptoKey, expectedContext: z.infer<typeof ShareContext>) {
  const s = SharedSchema.parse(input), context = ShareContext.parse(expectedContext)
  if (JSON.stringify(context) !== JSON.stringify(s.context)) throw new Error('Wrong recipient or trade')
  return unpack(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unhex(s.iv), additionalData: text.encode(JSON.stringify(context)) }, await sharedKey(recipientPrivateKey, s.ephemeral, context), unhex(s.ciphertext)))
}
