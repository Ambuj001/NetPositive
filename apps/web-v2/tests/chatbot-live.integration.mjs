import assert from 'node:assert/strict'
import { AssistantFlow } from '../src/lib/assistant-flow.ts'
import { chatbot } from '../src/lib/chatbot.ts'
const id = `integration_${Date.now()}`
let draft
const bridge = {
  onStore() {},
  onDraft(value) {
    draft = value
  },
  onPost: async () => 'preview-integration',
  onRequest: () => ({
    brand: draft.request.voucher_brand,
    amount: draft.request.amount_inr,
  }),
  onPortfolio() {},
  localCommand: () => null,
}
try {
  const seller = new AssistantFlow('sell', `${id}_seller`, bridge)
  await seller.start()
  assert.equal(seller.state.online, true)
  await seller.search('Nike shoes from Amazon')
  const tiles = seller.state.messages
    .at(-1)
    .blocks.find((b) => b.kind === 'tiles')
  assert.ok(tiles)
  const store = tiles.data.selected || tiles.data.tiles?.[0]
  assert.ok(store)
  seller.pickStore(store)
  await seller.send('5.5k')
  assert.equal(seller.state.step, 'confirm')
  assert.equal(draft.request.amount_inr, 5500)
  assert.equal(
    draft.request.suggested_split.reduce((a, b) => a + b, 0),
    5500,
  )
  await seller.post()
  assert.equal(seller.state.step, 'posted')
  console.log(
    'PASS real merchant search → store → amount → draft → preview-post callback',
  )
  const buyer = new AssistantFlow('buy', id, bridge)
  await buyer.start()
  assert.equal(buyer.state.online, true)
  await buyer.addCard('HDFC Infinia')
  assert.deepEqual(buyer.state.portfolio, ['HDFC Infinia'])
  buyer.showRequests()
  await buyer.pickRequest('sample-request')
  const result = buyer.state.messages
    .at(-1)
    .blocks.find((b) => b.kind === 'options')
  assert.ok(result?.data.options.length)
  assert.equal(result.data.options[0].best, true)
  assert.ok(
    result.data.options.every((o) => buyer.state.portfolio.includes(o.card)),
  )
  assert.equal(result.data.must_match.total_amount_inr, 5500)
  assert.ok(result.data.options[0].source)
  assert.ok(result.data.options[0].checked_on)
  buyer.chooseRoute('sample-request', result.data.options[0])
  assert.equal(buyer.state.step, 'purchase')
  console.log(
    'PASS real buyer portfolio → owned-card ranking → source dates → route selection',
  )
  await buyer.removeCard('HDFC Infinia')
  assert.equal(buyer.state.portfolio.length, 0)
  console.log('PASS real portfolio removal')
} finally {
  const portfolio = await chatbot.portfolio(id).catch(() => ({ cards: [] }))
  for (const card of portfolio.cards) await chatbot.removeCard(id, card)
  await chatbot.reset(id, 'buyer').catch(() => {})
  await chatbot.reset(`${id}_seller`, 'seller').catch(() => {})
}
