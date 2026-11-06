import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  AssistantFlow,
  parseAssistantAmount,
  type AssistantService,
  type FlowBridge,
} from '../src/lib/assistant-flow.ts'
import {
  ChatbotError,
  type Draft,
  type Fulfil,
  type Tile,
} from '../src/lib/chatbot.ts'
import {
  denominations,
  expiryOk,
  formatExpiry,
  safeUrl,
  voucherOk,
} from '../src/lib/vouchers.ts'
import { orderApi, toOrder } from '../src/lib/order-api.ts'
const store: Tile = {
  merchant_id: 'nike',
  name: 'Nike',
  site: 'nike.com',
  voucher_brand: 'Nike',
  category: 'Fashion',
}
const draft: Draft = {
  ok: true,
  request: {
    merchant_id: 'nike',
    merchant: 'Nike',
    voucher_brand: 'Nike',
    item: 'shoes',
    amount_inr: 5500,
    suggested_split: [5000, 500],
  },
  disclaimers: [],
}
const fulfil: Fulfil = {
  voucher_brand: 'Nike',
  amount_inr: 5500,
  options: [],
  not_recommended: [],
  no_data_for_cards: [],
  second_option: { name: 'CRED', url: 'https://cred.club', note: '' },
  notes: [],
  must_match: {
    voucher_brand: 'Nike',
    total_amount_inr: 5500,
    suggested_split: [5000, 500],
    tip: '',
  },
}
function fixture() {
  const calls: unknown[][] = []
  let portfolio: string[] = []
  const service: AssistantService = {
    health: async () => ({ ok: true, model: '' }),
    portfolio: async (id) => {
      calls.push(['portfolio', id])
      return { cards: portfolio }
    },
    addCard: async (id, card) => {
      portfolio = [...portfolio, card]
      calls.push(['addCard', id, card])
      return { ok: true, added: card, portfolio }
    },
    removeCard: async (_id, card) => {
      portfolio = portfolio.filter((c) => c !== card)
      return { ok: true, removed: card, portfolio }
    },
    suggest: async (query) => {
      calls.push(['suggest', query])
      return { mode: 'store_locked', item: 'shoes', selected: store, notes: [] }
    },
    draft: async (...args) => {
      calls.push(['draft', ...args])
      return draft
    },
    fulfil: async (...args) => {
      calls.push(['fulfil', ...args])
      return fulfil
    },
    chat: async (...args) => {
      calls.push(['chat', ...args])
      return { reply: 'Answer', tools_used: [] }
    },
    reset: async (...args) => {
      calls.push(['reset', ...args])
      return { ok: true }
    },
  }
  const bridge: FlowBridge = {
    onStore: (s) => calls.push(['store', s.merchant_id]),
    onDraft: (d) => calls.push(['ticket', d.request.amount_inr]),
    onPost: async () => {
      calls.push(['post'])
      return 'NP-test'
    },
    onRequest: (id) => {
      calls.push(['request', id])
      return { brand: 'Nike', amount: 5500 }
    },
    onPortfolio: (names) => calls.push(['sync', names]),
    localCommand: (text) => (text === 'buy 10000' ? 'Budget updated.' : null),
  }
  return { service, bridge, calls }
}
test('seller preserves store → amount → draft → post payload and updates the ticket', async () => {
  const { service, bridge, calls } = fixture()
  const flow = new AssistantFlow('sell', 'wallet-a', bridge, service)
  await flow.start()
  await flow.send('Nike shoes')
  assert.equal(flow.state.step, 'pick_store')
  flow.pickStore(store)
  assert.equal(flow.state.step, 'ask_amount')
  await flow.send('5.5k')
  assert.deepEqual(
    calls.find((c) => c[0] === 'draft'),
    ['draft', 'nike', 5500, 'shoes'],
  )
  assert.equal(flow.state.step, 'confirm')
  assert.deepEqual(
    calls.find((c) => c[0] === 'ticket'),
    ['ticket', 5500],
  )
  await flow.post()
  await flow.post()
  assert.equal(calls.filter((c) => c[0] === 'post').length, 1)
  assert.equal(flow.state.step, 'posted')
})
test('unavailable locked merchant shows alternatives, not an unavailable choice', async () => {
  const { service, bridge } = fixture()
  service.suggest = async () => ({
    mode: 'store_locked',
    item: null,
    selected: store,
    voucher_available: false,
    alternatives: [{ ...store, merchant_id: 'amazon', name: 'Amazon' }],
    notes: [],
  })
  const flow = new AssistantFlow('sell', 'a', bridge, service)
  await flow.search('Nike')
  const block = flow.state.messages
    .at(-1)!
    .blocks.find((b) => b.kind === 'tiles')
  assert.equal(block?.kind, 'tiles')
  if (block?.kind === 'tiles') {
    assert.equal(block.data.mode, 'tiles')
    assert.equal(block.data.selected, null)
    assert.equal(block.data.tiles?.[0].merchant_id, 'amazon')
  }
})
test('buyer uses its own portfolio and exact fulfil payload; own-card route remains available', async () => {
  const { service, bridge, calls } = fixture()
  const flow = new AssistantFlow('buy', 'wallet-b', bridge, service)
  await flow.start()
  await flow.send('HDFC Infinia')
  assert.deepEqual(
    calls.find((c) => c[0] === 'addCard'),
    ['addCard', 'wallet-b', 'HDFC Infinia'],
  )
  flow.showRequests()
  await flow.pickRequest('REQ-1')
  assert.deepEqual(
    calls.find((c) => c[0] === 'fulfil'),
    ['fulfil', 'wallet-b', 'Nike', 5500],
  )
  assert.equal(flow.state.step, 'options')
  flow.chooseRoute('REQ-1', null)
  assert.equal(flow.state.step, 'purchase')
  assert.deepEqual(flow.state.messages.at(-1)?.blocks, [
    { kind: 'purchase', orderId: 'REQ-1', route: null },
  ])
})
test('guided steps continue without an LLM key and local ticket commands do not become card names', async () => {
  const { service, bridge, calls } = fixture()
  service.chat = async () => {
    throw new ChatbotError('no_ai_key', 'OPENROUTER_API_KEY missing')
  }
  const flow = new AssistantFlow('buy', 'a', bridge, service)
  await flow.start()
  await flow.send('buy 10000')
  assert.equal(
    calls.some((c) => c[0] === 'addCard'),
    false,
  )
  await flow.send('What is my best option?')
  assert.equal(flow.state.aiReady, false)
  assert.equal(flow.state.step, 'cards')
  await flow.addCard('HDFC Infinia')
  assert.equal(flow.state.portfolio[0], 'HDFC Infinia')
})
test('reset clears server conversation with correct role and reinitializes the guided flow', async () => {
  const { service, bridge, calls } = fixture()
  const flow = new AssistantFlow('sell', 'a', bridge, service)
  flow.pickStore(store)
  await flow.reset()
  assert.deepEqual(
    calls.find((c) => c[0] === 'reset'),
    ['reset', 'a', 'seller'],
  )
  assert.equal(flow.state.step, 'ask_item')
  assert.equal(flow.state.store, null)
})
test('an in-flight response cannot mutate a disposed wallet conversation', async () => {
  const { service, bridge, calls } = fixture()
  let resolve!: (s: Draft) => void
  service.draft = () =>
    new Promise((r) => {
      resolve = r
    })
  const flow = new AssistantFlow('sell', 'a', bridge, service)
  flow.pickStore(store)
  const pending = flow.amount(5500)
  flow.dispose()
  resolve(draft)
  await pending
  assert.equal(
    calls.some((c) => c[0] === 'ticket'),
    false,
  )
  assert.equal(flow.state.draft, null)
})
test('duplicate clicks cannot run concurrent draft operations', async () => {
  const { service, bridge } = fixture()
  let n = 0,
    resolve!: (s: Draft) => void
  service.draft = () => {
    n++
    return new Promise((r) => {
      resolve = r
    })
  }
  const flow = new AssistantFlow('sell', 'a', bridge, service)
  flow.pickStore(store)
  const one = flow.amount(5500)
  await flow.amount(5500)
  assert.equal(n, 1)
  resolve(draft)
  await one
})
test('voucher validation preserves PIN and future-month expiry rules and exact remainders', () => {
  assert.equal(parseAssistantAmount('5.5k'), 5500)
  assert.equal(parseAssistantAmount('₹2,00,000'), 200000)
  assert.equal(parseAssistantAmount('1e4'), null)
  assert.equal(parseAssistantAmount('0.25k'), 250)
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
