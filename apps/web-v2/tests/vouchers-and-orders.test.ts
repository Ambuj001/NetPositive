import assert from 'node:assert/strict'
import { test } from 'node:test'
import { denominations, expiryOk, formatExpiry, safeUrl, voucherOk } from '../src/lib/vouchers.ts'
import { orderApi, toOrder } from '../src/lib/order-api.ts'
test('voucher validation preserves PIN and future-month expiry rules and exact remainders', () => {
  assert.deepEqual(denominations(12500), [5000, 5000, 2500])
  assert.equal(formatExpiry('1299'), '12/99')
  assert.equal(expiryOk('13/99'), false)
  assert.equal(expiryOk('01/26', new Date('2026-11-06')), false)
  assert.equal(expiryOk('11/26', new Date('2026-11-06')), true)
  assert.equal(
    voucherOk({ code: 'ABC12345', pin: '123456', expiry: '12/99' }),
    true,
  )
  assert.equal(
    voucherOk({ code: 'ABC12345', pin: 'abc', expiry: '12/99' }),
    false,
  )
  assert.equal(safeUrl('javascript:alert(1)'), undefined)
})
test('live lifecycle keeps backend ids and sends only the supported code/PIN payload', async () => {
  const original = globalThis.fetch
  const calls: { url: string; body: unknown }[] = []
  globalThis.fetch = async (url, init) => {
    calls.push({
      url: String(url),
      body: JSON.parse(String(init?.body || 'null')),
    })
    return Response.json({ request: { id: 'request/a' } })
  }
  try {
    await orderApi.submit('request/a', 'session', 'ABC123', '1234')
    assert.ok(calls[0].url.endsWith('/requests/request%2Fa/submit-code'))
    assert.deepEqual(calls[0].body, { code: 'ABC123', pin: '1234' })
    await orderApi.accept('request/a', 'session')
    assert.ok(calls[1].url.endsWith('/accept'))
    assert.deepEqual(calls[1].body, {})
  } finally {
    globalThis.fetch = original
  }
})
test('order mapping preserves the requested merchant and raw backend amounts', () => {
  const order = toOrder({
    id: 'r',
    brand: 'makemytrip',
    amountInr: 10000,
    amountUsdc: '112.22',
    requester: '0x111',
    fulfiller: null,
    status: 'open',
    escrowId: 'x',
    escrowTxHash: null,
    releaseTxHash: null,
    refundTxHash: null,
    fulfilDeadline: null,
    reviewDeadline: null,
    createdAt: null,
  })
  assert.equal(order.brandId, 'mmt')
  assert.equal(order.source, 'live')
  assert.equal(order.rate, 10000 / 112.22)
})
