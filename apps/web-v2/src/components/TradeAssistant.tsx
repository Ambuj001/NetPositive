import { useEffect, useState } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Maximize2, MessageCircle } from 'lucide-react'
import type { Draft, FulfilOption, Tile } from '../lib/chatbot'
import { userIdFor } from '../lib/chatbot'
import type { Order } from '../lib/data'
import { useApp } from '../lib/store'
import UpstreamAssistant from './UpstreamAssistant'

type Props = {
  mode: 'buy' | 'sell'; active: boolean; expanded: boolean; setExpanded: (expanded: boolean) => void;
  orders: Order[]; source: string; rate: number;
  onStore: (store: Tile) => void; onDraft: (draft: Draft) => void;
  onPost: (draft: Draft) => Promise<Order | null>;
  onSelectRequest: (order: Order) => void; onSelectRoute: (order: Order, route: FulfilOption | null) => void;
  onOpenTrade: (order: Order) => void;
  localCommand: (text: string) => string | null;
  external?: { key: number; order?: Order; store?: Tile };
}
/** Only the shell is ours. Conversation steps, quick replies and blocks come from backend-_ui. */
export function TradeAssistant(props: Props) {
  const { fullAddress } = useApp()
  const [guest] = useState(() => `guest_${crypto.randomUUID()}`)
  const [session, setSession] = useState(0)
  const [known, setKnown] = useState<Record<string, Order>>({})
  const [opened, setOpened] = useState(false)
  const open = () => { setOpened(true); props.setExpanded(true) }
  useEffect(()=>{if(props.active)setOpened(true)},[props.active])
  const ready = opened || props.active
  return <section hidden={!props.active} className="trade-chat exact-chat-shell" aria-label={`${props.mode === 'sell' ? 'Pay with crypto' : 'Buy'} assistant`}>
    {!props.expanded && <div className="chat-panel-heading"><span><MessageCircle size={16} />NetPositive</span><button className="icon-button" onClick={open} aria-label="Expand chat"><Maximize2 size={15} /></button></div>}
    <AnimatePresence initial={false}><motion.div initial={false} animate={{ height: props.expanded ? 'auto' : 0, opacity: props.expanded ? 1 : 0 }} transition={{duration:.4,ease:[.16,1,.3,1]}} style={{overflow:'hidden'}} aria-hidden={!props.expanded} inert={!props.expanded}>
      {ready && <UpstreamAssistant key={session} mode={props.mode === 'sell' ? 'spend' : 'buy'} userId={userIdFor(fullAddress || guest)} orders={props.orders}
        onRestart={() => setSession(v => v + 1)} onClose={() => {setOpened(true);props.setExpanded(false)}}
        onStore={props.onStore} onDraft={props.onDraft}
        onPost={async draft => { const order = await props.onPost(draft); if (order) setKnown(all => ({...all,[order.id]:order}));return order }}
        onRequest={id => {const order=props.orders.find(o=>o.id===id)||known[id];if(order)props.onSelectRequest(order)}}
        onOpenTrade={id => {const order=props.orders.find(o=>o.id===id)||known[id];if(order)props.onOpenTrade(order)}} />}
    </motion.div></AnimatePresence>
    {!props.expanded && <button className="collapsed-chat-entry" onClick={open}><MessageCircle size={18}/><span>{props.mode === 'sell' ? 'What would you like to buy?' : 'Find a request or compare your cards…'}</span><Maximize2 size={16}/></button>}
  </section>
}
