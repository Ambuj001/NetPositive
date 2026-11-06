import assert from 'node:assert/strict'
import { test } from 'node:test'
import { CARDS, netRate, quote, routesFor } from '../src/lib/engine.ts'
import { previewBuy, bestSellRate, BUY_INTENTS } from '../src/lib/trading.ts'
import { ORDERS } from '../src/lib/data.ts'

test('seller fee is added once and effective rate includes it', () => {
  const q = quote(10000, 90)
  assert.equal(q.buyerReceives, 111.11)
  assert.equal(q.fee, 1.11)
  assert.equal(q.sellerLocks, 112.22)
  assert.equal(netRate(10000, q.sellerLocks), 89.11)
  assert.equal(q.reserveShare + q.platformShare, q.fee)
})
test('buyer net rate subtracts valued rewards without treating points as cash twice', () => {
  assert.equal(netRate(10000, 111.11, 495), 85.55)
  assert.equal(netRate(10000, 111.11, 1650), 75.15)
  assert.equal(netRate(0, 0, 0), null)
  assert.equal(netRate(100, 10, 101), null)
  assert.equal(netRate(NaN, 10, 0), null)
})
test('voucher denominations round earnings separately and remaining cap limits bonus', () => {
  const card = { ...CARDS[0], bonusUsed: 2900 }
  const route = routesFor(5500, [card]).find(
    (r) => r.channel.id === 'smartbuy',
  )!
  assert.equal(route.txns, 2)
  assert.equal(route.bonusPoints, 100)
  assert.equal(route.points, 280) // 5,000 -> 165 base, 500 -> 15 base, plus 100 bonus
  assert.equal(route.capLeftAfter, 0)
  assert.deepEqual(routesFor(0), [])
})
test('discounted voucher spend determines base points', () => {
  const card = {
    ...CARDS[0],
    channels: [
      {
        id: 'discount',
        name: 'discount',
        multiplier: 1,
        denomination: 5000,
        instantDiscount: 0.1,
        note: '',
      },
    ],
  }
  const r = routesFor(5000, [card])[0]
  assert.equal(r.points, 150)
  assert.equal(r.discountInr, 500)
})
test('market uses affordable lots for slippage and never spends unallocated budget', () => {
  const r = previewBuy(ORDERS, 10000, 'market', 90, 1)
  assert.equal(r.spend, 10000)
  assert.equal(r.receive, 111.11)
  assert.equal(r.fills[0].brandId, 'lifestyle')
  const remainder = previewBuy(ORDERS, 10400, 'market', 90, 1)
  assert.equal(remainder.remainder, 400)
  assert.equal(remainder.spend + remainder.remainder, 10400)
})
test('slippage and limit boundaries reject out-of-range prices and invalid inputs', () => {
  const lots = [
    { ...ORDERS[0], id: 'a', amount: 1000, rate: 90 },
    { ...ORDERS[0], id: 'b', amount: 1000, rate: 93 },
  ]
  assert.equal(previewBuy(lots, 2000, 'market', 0, 1).fills.length, 1)
  assert.equal(previewBuy(lots, 2000, 'market', 0, 8).fills.length, 2)
  assert.equal(previewBuy(lots, 2000, 'limit', 89, 8).fills.length, 0)
  assert.equal(previewBuy(lots, 2000, 'limit', 90, 8).fills.length, 1)
  assert.equal(previewBuy(lots, 2000, 'market', 0, NaN).fills.length, 0)
  assert.equal(previewBuy(lots, -1, 'market', 0, 1).fills.length, 0)
  assert.equal(bestSellRate(BUY_INTENTS, 'lifestyle', 10000, 'limit', 91), null)
})
