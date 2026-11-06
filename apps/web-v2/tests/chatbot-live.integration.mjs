import assert from 'node:assert/strict'
import {chatbot} from '../src/lib/chatbot.ts'
const id=`integration_${Date.now()}`
try {
 assert.equal((await chatbot.health()).ok,true)
 const search=await chatbot.suggest('Nike shoes from Amazon')
 const store=search.selected||search.tiles?.[0];assert.ok(store)
 const draft=await chatbot.draft(store.merchant_id,5500,search.item)
 assert.equal(draft.request.amount_inr,5500)
 assert.equal(draft.request.suggested_split.reduce((a,b)=>a+b,0),5500)
 console.log('PASS original seller endpoint sequence: suggest → pick store → draft')
 await chatbot.addCard(id,'HDFC Infinia')
 const pf=await chatbot.portfolio(id);assert.deepEqual(pf.cards,['HDFC Infinia'])
 const fulfil=await chatbot.fulfil(id,draft.request.voucher_brand,draft.request.amount_inr)
 assert.ok(fulfil.options.length);assert.equal(fulfil.options[0].best,true)
 assert.ok(fulfil.options.every(o=>pf.cards.includes(o.card)))
 assert.equal(fulfil.must_match.total_amount_inr,5500)
 assert.ok(fulfil.options[0].source);assert.ok(fulfil.options[0].checked_on)
 console.log('PASS original buyer endpoint sequence: portfolio → add → fulfil → portal options')
 await chatbot.removeCard(id,'HDFC Infinia');assert.equal((await chatbot.portfolio(id)).cards.length,0)
 console.log('PASS portfolio removal')
} finally {for(const card of (await chatbot.portfolio(id).catch(()=>({cards:[]}))).cards)await chatbot.removeCard(id,card);await chatbot.reset(id,'buyer').catch(()=>{})}
