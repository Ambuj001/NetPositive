import { mkdirSync, chmodSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { createApp } from './app.ts'

process.umask(0o077)
const origin = process.env.APP_ORIGIN ?? 'http://127.0.0.1:5173'
const database = resolve(process.env.VAULT_DATABASE ?? '../../var/vault.sqlite')
mkdirSync(dirname(database), { recursive: true, mode: 0o700 })
if (process.env.NODE_ENV === 'production' && (!process.env.APP_ORIGIN || !process.env.VAULT_DATABASE || !process.env.WORLD_RP_ID)) throw new Error('Set production origin, persistent database path and World ID configuration')
const worldValues = [process.env.WORLD_APP_ID, process.env.WORLD_RP_ID, process.env.WORLD_RP_SIGNING_KEY]
if (worldValues.some(Boolean) && !worldValues.every(Boolean)) throw new Error('Incomplete World ID configuration')
const environment = process.env.WORLD_ENVIRONMENT ?? 'staging'
if (!['staging', 'production'].includes(environment) || (process.env.NODE_ENV === 'production' && environment !== 'production')) throw new Error('Invalid World ID environment')
const world = worldValues.every(Boolean) ? { appId: worldValues[0]!, rpId: worldValues[1]!, signingKey: worldValues[2]!, environment: environment as 'staging' | 'production' } : undefined
const app = await createApp({ database, origin, world })
chmodSync(database, 0o600)
for (const signal of ['SIGINT', 'SIGTERM'] as const) process.once(signal, async () => { await app.close(); process.exit(0) })
await app.listen({ host: process.env.HOST ?? '127.0.0.1', port: Number(process.env.PORT ?? 8787) })
console.info('NetPositive vault API listening; request and secret logging disabled.')
