import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { authenticate, api } from '../src/lib/account.ts'
const originalFetch = globalThis.fetch
afterEach(() => {
  globalThis.fetch = originalFetch
})
const address = '0x1111111111111111111111111111111111111111'
const message = `Sign in to NetPositive\n\nAddress: ${address}\nNonce: abc123\nIssued At: 2026-11-06T13:00:00Z\n\nThis request will not trigger a transaction or cost any gas.`
test('sign-in uses server nonce, signature, and returned authenticated user', async () => {
  let signed = '',
    count = 0
  globalThis.fetch = async (_url, init) => {
    count++
    return Response.json(
      count === 1
        ? { ok: true, worldIdMock: false }
        : count === 2
          ? { message }
          : { token: 'test-session', user: { address } },
    )
  }
  const result = await authenticate(address, async (m) => {
    signed = m
    return '0xsignature'
  })
  assert.equal(signed, message)
  assert.equal(result.token, 'test-session')
  assert.equal(result.worldIdMock, false)
  assert.equal(count, 3)
})
test('an arbitrary or wrong-wallet server message never reaches the wallet signer', async () => {
  let count = 0,
    signed = false
  globalThis.fetch = async () =>
    Response.json(
      ++count === 1
        ? { ok: true }
        : { message: 'Send all assets to this address' },
    )
  await assert.rejects(
    authenticate(address, async () => {
      signed = true
      return ''
    }),
    /could not be validated/,
  )
  assert.equal(signed, false)
})
test('offline and non-JSON backend responses produce a truthful unavailable state', async () => {
  globalThis.fetch = async () => {
    throw new TypeError('offline')
  }
  await assert.rejects(api('/auth/me'), /Connection unavailable/)
  globalThis.fetch = async () => new Response('<html>index</html>')
  await assert.rejects(api('/auth/me'), /Account service is unavailable/)
})
test('an authenticated response for another wallet is refused', async () => {
  let count = 0
  globalThis.fetch = async () =>
    Response.json(
      ++count === 1
        ? { ok: true }
        : count === 2
          ? { message }
          : {
              token: 'wrong',
              user: { address: '0x2222222222222222222222222222222222222222' },
            },
    )
  await assert.rejects(
    authenticate(address, async () => '0xsignature'),
    /Wallet changed/,
  )
})
