import {
  ChatbotError,
  chatbot,
  type Draft,
  type Fulfil,
  type FulfilOption,
  type Suggest,
  type Tile,
} from './chatbot.ts'

export type AssistantMode = 'buy' | 'sell'
export type AssistantStep =
  | 'ask_item'
  | 'pick_store'
  | 'ask_amount'
  | 'confirm'
  | 'posted'
  | 'cards'
  | 'pick_request'
  | 'options'
  | 'purchase'
export type ChatBlock =
  | { kind: 'text'; text: string }
  | { kind: 'tiles'; data: Suggest }
  | { kind: 'draft'; data: Draft }
  | { kind: 'portfolio'; cards: string[] }
  | { kind: 'requests' }
  | { kind: 'options'; data: Fulfil; orderId: string }
  | { kind: 'posted'; orderId: string }
  | { kind: 'purchase'; orderId: string; route: FulfilOption | null }
  | { kind: 'tracking'; orderId: string }
  | { kind: 'offline' }
export type ChatMessage = {
  id: string
  from: 'bot' | 'user'
  blocks: ChatBlock[]
}
export type AssistantState = {
  messages: ChatMessage[]
  step: AssistantStep
  portfolio: string[]
  busy: boolean
  online: boolean | null
  aiReady: boolean | null
  store: Tile | null
  item: string | null
  draft: Draft | null
}
export type FlowBridge = {
  onStore: (store: Tile) => void
  onDraft: (draft: Draft) => void
  onPost: (draft: Draft) => Promise<string | null>
  onRequest: (id: string) => { brand: string; amount: number } | null
  onPortfolio: (cards: string[]) => void
  localCommand: (text: string) => string | null
}
export type AssistantService = Pick<
  typeof chatbot,
  | 'health'
  | 'portfolio'
  | 'addCard'
  | 'removeCard'
  | 'suggest'
  | 'draft'
  | 'fulfil'
  | 'chat'
  | 'reset'
>
export const QUICK_STORES: Tile[] = [
  {
    merchant_id: 'amazon',
    name: 'Amazon',
    voucher_brand: 'Amazon',
    category: 'Shopping',
    site: 'amazon.in',
  },
  {
    merchant_id: 'myntra',
    name: 'Myntra',
    voucher_brand: 'Myntra',
    category: 'Fashion',
    site: 'myntra.com',
  },
  {
    merchant_id: 'flipkart',
    name: 'Flipkart',
    voucher_brand: 'Flipkart',
    category: 'Shopping',
    site: 'flipkart.com',
  },
  {
    merchant_id: 'ajio',
    name: 'AJIO',
    voucher_brand: 'AJIO',
    category: 'Fashion',
    site: 'ajio.com',
  },
  {
    merchant_id: 'nike',
    name: 'Nike',
    voucher_brand: 'Nike',
    category: 'Fashion',
    site: 'nike.com',
  },
]
export function parseAssistantAmount(text: string): number | null {
  const match =
    /^\s*(?:₹|rs\.?\s*|inr\s*)?([\d,]+(?:\.\d{1,2})?)\s*(k)?\s*$/i.exec(text)
  if (!match) return null
  const value = Number(match[1].replaceAll(',', '')) * (match[2] ? 1000 : 1)
  return Number.isFinite(value) && value >= 250 && value <= 200000
    ? value
    : null
}
/** Guided steps and payloads preserved from backend-_ui 36f95eb. No reward math is delegated to the LLM. */
export class AssistantFlow {
  state: AssistantState
  private listeners = new Set<() => void>()
  private epoch = 0
  private active = true
  readonly mode: AssistantMode
  readonly userId: string
  private bridge: FlowBridge
  private service: AssistantService
  constructor(
    mode: AssistantMode,
    userId: string,
    bridge: FlowBridge,
    service: AssistantService = chatbot,
  ) {
    this.mode = mode
    this.userId = userId
    this.bridge = bridge
    this.service = service
    this.state = this.fresh()
  }
  private fresh(): AssistantState {
    return {
      messages: [],
      step: this.mode === 'sell' ? 'ask_item' : 'cards',
      portfolio: [],
      busy: false,
      online: null,
      aiReady: null,
      store: null,
      item: null,
      draft: null,
    }
  }
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }
  snapshot = () => this.state
  private set(patch: Partial<AssistantState>) {
    this.state = { ...this.state, ...patch }
    this.listeners.forEach((f) => f())
  }
  private push(from: ChatMessage['from'], ...blocks: ChatBlock[]) {
    this.set({
      messages: [
        ...this.state.messages,
        { id: crypto.randomUUID(), from, blocks },
      ].slice(-100),
    })
  }
  private say(text: string) {
    this.push('bot', { kind: 'text', text })
  }
  private fail(error: unknown) {
    if (error instanceof ChatbotError && error.kind === 'offline') {
      this.set({ online: false })
      this.push('bot', { kind: 'offline' })
    } else if (error instanceof ChatbotError && error.kind === 'no_ai_key') {
      this.set({ aiReady: false })
      this.say(
        'Guided steps are available. Free-form answers are currently unavailable.',
      )
    } else
      this.say(
        error instanceof Error
          ? error.message
          : 'Something went wrong. Please try again.',
      )
  }
  private async work(task: (current: () => boolean) => Promise<void>) {
    if (this.state.busy) return
    const e = this.epoch
    this.set({ busy: true })
    const current = () => this.active && this.epoch === e
    try {
      await task(current)
    } catch (error) {
      if (current()) this.fail(error)
    } finally {
      if (current()) this.set({ busy: false })
    }
  }
  activate() {
    this.active = true
  }
  trackOrder(id: string) {
    if (this.state.busy) return
    this.push('bot', { kind: 'tracking', orderId: id })
  }
  dispose() {
    this.active = false
    this.epoch++
  }
  async start() {
    this.active = true
    this.epoch++
    this.set({ ...this.fresh() })
    await this.work(async (current) => {
      await this.service.health()
      if (!current()) return
      this.set({ online: true })
      if (this.mode === 'sell')
        this.say(
          'Where would you like to spend your crypto? Pick a store or tell us what you need.',
        )
      else {
        const pf = await this.service.portfolio(this.userId)
        if (!current()) return
        this.set({ portfolio: pf.cards })
        if (pf.cards.length) this.bridge.onPortfolio(pf.cards)
        this.push(
          'bot',
          {
            kind: 'text',
            text: pf.cards.length
              ? 'Your cards are ready. Add another or find a request.'
              : 'Which cards do you hold? Add a card to compare purchase routes.',
          },
          { kind: 'portfolio', cards: pf.cards },
        )
      }
    })
  }
  async reset() {
    if (this.state.busy) return
    await this.work(async (current) => {
      try {
        await this.service.reset(
          this.userId,
          this.mode === 'sell' ? 'seller' : 'buyer',
        )
      } catch (e) {
        if (!(
          e instanceof ChatbotError &&
          (e.kind === 'offline' || e.kind === 'no_ai_key')
        ))
          throw e
      }
      if (current()) this.set(this.fresh())
    })
    await this.start()
  }
  async search(query: string) {
    await this.work(async (current) => {
      this.push('user', { kind: 'text', text: query })
      const result = await this.service.suggest(query)
      if (!current()) return
      const missing =
        result.mode === 'store_locked' && result.voucher_available === false
      const data = missing
        ? {
            ...result,
            mode: 'tiles' as const,
            selected: null,
            tiles: result.alternatives ?? [],
          }
        : result
      this.set({ item: result.item, step: 'pick_store' })
      this.push(
        'bot',
        {
          kind: 'text',
          text: missing
            ? 'That store has no voucher available. Choose an alternative.'
            : result.mode === 'fallback'
              ? 'Choose a store or refine your search.'
              : 'Choose a store to continue.',
        },
        { kind: 'tiles', data },
      )
    })
  }
  pickStore(store: Tile) {
    if (this.state.busy) return
    this.set({ store, draft: null, step: 'ask_amount' })
    this.bridge.onStore(store)
    this.push('user', { kind: 'text', text: store.name })
    this.say('How much would you like to spend?')
  }
  async amount(value: number) {
    const store = this.state.store
    if (!store) return
    if (!Number.isFinite(value) || value < 250 || value > 200000) {
      this.say('Choose an amount between ₹250 and ₹2,00,000.')
      return
    }
    await this.work(async (current) => {
      this.push('user', {
        kind: 'text',
        text: `₹${value.toLocaleString('en-IN')}`,
      })
      const draft = await this.service.draft(
        store.merchant_id,
        value,
        this.state.item,
      )
      if (!current()) return
      this.set({ draft, step: 'confirm' })
      this.bridge.onDraft(draft)
      this.push(
        'bot',
        { kind: 'text', text: 'Review your voucher request.' },
        { kind: 'draft', data: draft },
      )
    })
  }
  changeAmount() {
    if (this.state.busy) return
    this.set({ step: 'ask_amount', draft: null })
    this.say('What is the new amount?')
  }
  async post() {
    const draft = this.state.draft
    if (!draft || this.state.step !== 'confirm') return
    await this.work(async (current) => {
      const id = await this.bridge.onPost(draft)
      if (!current() || !id) return
      this.set({ step: 'posted' })
      this.push('bot', { kind: 'posted', orderId: id })
    })
  }
  async addCard(name: string) {
    await this.work(async (current) => {
      this.push('user', { kind: 'text', text: name })
      const r = await this.service.addCard(this.userId, name)
      if (!current()) return
      this.set({ portfolio: r.portfolio, step: 'cards' })
      this.bridge.onPortfolio(r.portfolio)
      this.push(
        'bot',
        { kind: 'text', text: `${r.added} added.` },
        { kind: 'portfolio', cards: r.portfolio },
      )
    })
  }
  async removeCard(name: string) {
    await this.work(async (current) => {
      const r = await this.service.removeCard(this.userId, name)
      if (!current()) return
      this.set({ portfolio: r.portfolio })
      this.bridge.onPortfolio(r.portfolio)
    })
  }
  async usePortfolio(names: string[]) {
    await this.work(async (current) => {
      let portfolio = this.state.portfolio
      for (const name of names) {
        if (!current()) return
        const r = await this.service.addCard(this.userId, name)
        portfolio = r.portfolio
        this.set({ portfolio })
        this.bridge.onPortfolio(portfolio)
      }
      if (current()) {
        this.set({ step: 'cards' })
        this.push('bot', { kind: 'portfolio', cards: portfolio })
      }
    })
  }
  showRequests() {
    if (this.state.busy) return
    this.set({ step: 'pick_request' })
    this.push(
      'bot',
      { kind: 'text', text: 'Choose a voucher request to compare your cards.' },
      { kind: 'requests' },
    )
  }
  async pickRequest(id: string) {
    const order = this.bridge.onRequest(id)
    if (!order) return
    await this.work(async (current) => {
      this.push('user', {
        kind: 'text',
        text: `${order.brand} · ₹${order.amount.toLocaleString('en-IN')}`,
      })
      const fulfil = await this.service.fulfil(
        this.userId,
        order.brand,
        order.amount,
      )
      if (!current()) return
      this.set({ step: 'options' })
      this.push(
        'bot',
        {
          kind: 'text',
          text: fulfil.options.length
            ? 'Your purchase routes, ranked by the recommendation service.'
            : 'No researched routes for your selected cards. You can use your own route.',
        },
        { kind: 'options', data: fulfil, orderId: id },
      )
    })
  }
  chooseRoute(id: string, route: FulfilOption | null) {
    if (this.state.busy) return
    this.set({ step: 'purchase' })
    this.push('bot', { kind: 'purchase', orderId: id, route })
  }
  async send(text: string) {
    const value = text.trim()
    if (!value || this.state.busy) return
    if (
      this.mode === 'buy' &&
      /^(?:(?:compare|show|manage)\s+(?:my\s+)?cards|my cards|cards)[?.!]?$/i.test(
        value,
      )
    ) {
      this.set({ step: 'cards' })
      this.push('user', { kind: 'text', text: value })
      this.push('bot', { kind: 'portfolio', cards: this.state.portfolio })
      return
    }
    const local = this.bridge.localCommand(value)
    if (local) {
      this.push('user', { kind: 'text', text: value })
      this.say(local)
      return
    }
    if (this.mode === 'sell') {
      if (this.state.step === 'ask_item' || this.state.step === 'pick_store')
        return this.search(value)
      if (this.state.step === 'ask_amount') {
        const amount = parseAssistantAmount(value)
        if (amount !== null) return this.amount(amount)
        this.say('Enter an amount between ₹250 and ₹2,00,000.')
        return
      }
    }
    if (
      this.mode === 'buy' &&
      this.state.step === 'cards' &&
      !/\?|\b(best|which|how|why|what)\b/i.test(value)
    )
      return this.addCard(value)
    await this.work(async (current) => {
      this.push('user', { kind: 'text', text: value })
      const response = await this.service.chat(
        this.userId,
        this.mode === 'sell' ? 'seller' : 'buyer',
        value,
      )
      if (!current()) return
      this.set({ aiReady: true })
      this.say(response.reply || 'Please try again.')
    })
  }
}
