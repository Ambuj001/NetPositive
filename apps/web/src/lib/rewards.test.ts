import { test } from 'node:test'
import assert from 'node:assert/strict'
import { rewardRoutes, voucherPreview } from './rewards.ts'

test('routes preserve rounding and find the higher-value route', () => {
  const routes = rewardRoutes(5000)
  assert.equal(routes[0].id, 'smartbuy')
  assert.equal(routes[0].value, 825)
  assert.equal(routes.find((r) => r.id === 'instadeals')?.value, 525)
  assert.equal(routes.find((r) => r.id === 'direct')?.value, 165)
})
test('cap exhaustion changes the recommendation', () => {
  const routes = rewardRoutes(5000, false)
  assert.equal(routes[0].id, 'instadeals')
  assert.equal(routes.find((r) => r.id === 'smartbuy')?.value, 165)
})
test('the voucher bonus cannot exceed 3000 points', () => {
  const routes = rewardRoutes(30000)
  assert.equal(routes.find((r) => r.id === 'smartbuy')?.value, 4000)
})
test('only the crypto seller, who buys the voucher, pays the platform fee', () => {
  assert.deepEqual(voucherPreview(5400, 'buy'), {
    principal: 60,
    fee: 0.6,
    total: 60.6,
  })
  assert.deepEqual(voucherPreview(5400, 'sell'), {
    principal: 60,
    fee: 0,
    total: 60,
  })
  const q = voucherPreview(5000, 'buy')
  assert.equal(q.total, Math.round((q.principal + q.fee) * 100) / 100)
})
test('invalid amounts never produce a trade or reward estimate', () => {
  for (const n of [NaN, Infinity, -1, 0, 100001])
    assert.throws(() => rewardRoutes(n))
  for (const n of [NaN, Infinity, 249, 50001])
    assert.throws(() => voucherPreview(n, 'buy'))
})
