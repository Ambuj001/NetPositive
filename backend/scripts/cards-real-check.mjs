// Saved cards against the REAL Firestore, through a running backend. Uses a throwaway wallet, checks the documents with the
// admin SDK, and DELETES everything it created (cards, user, sign-in nonce) at the end.
// Run (backend must be running against real Firestore):
//   CONFIRM_REAL_FIRESTORE=yes node scripts/cards-real-check.mjs [http://127.0.0.1:8080]
import 'dotenv/config';
import assert from 'node:assert/strict';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

if (process.env.CONFIRM_REAL_FIRESTORE !== 'yes') { console.error('Refusing: this writes to the real Firestore. Set CONFIRM_REAL_FIRESTORE=yes'); process.exit(2); }
const BASE = process.argv[2] || 'http://127.0.0.1:8080';
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const db = getFirestore(initializeApp({ credential: cert(sa), projectId: sa.project_id }));
console.log(`Backend ${BASE}   Firestore project ${sa.project_id}   (throwaway wallet, cleaned up at the end)\n`);

const acct = privateKeyToAccount(generatePrivateKey());
const addr = acct.address.toLowerCase();
const results = [];
async function check(name, fn) { try { await fn(); results.push(true); console.log(`  PASS  ${name}`); } catch (e) { results.push(false); console.log(`  FAIL  ${name}\n        ${String(e.message).replace(/\s+/g, ' ').slice(0, 300)}`); } }
async function call(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const t = await r.text(); let j; try { j = JSON.parse(t); } catch { j = {}; } return { status: r.status, body: j, text: t };
}
const card = (id, over = {}) => ({ id, issuer: 'HDFC', name: 'Infinia', last: 'Metal', gradient: '', pointsPer: 5, spendUnit: 150, travelValue: 1, statementValue: 0.3, bonusCap: 3000, bonusUsed: 0,
  channels: [{ id: 'smartbuy', name: 'SmartBuy 5X', multiplier: 5, denomination: 10000, note: 'Accelerated' }], ...over });
const cardsRef = db.collection('users').doc(addr).collection('cards');
let token;
try {
  await check('sign in with a throwaway wallet', async () => {
    const n = await call('POST', '/auth/nonce', { body: { address: acct.address } });
    const v = await call('POST', '/auth/verify', { body: { address: acct.address, signature: await acct.signMessage({ message: n.body.message }) } });
    assert.equal(v.status, 200, v.text); token = v.body.token;
  });
  await check('a new wallet has no cards (read from the real database)', async () => {
    const r = await call('GET', '/cards', { token }); assert.deepEqual(r.body, { cards: [], promptDismissed: false });
  });
  await check('adding a card creates the document users/{wallet}/cards/infinia in Firestore', async () => {
    assert.equal((await call('PUT', '/cards/infinia', { token, body: card('infinia') })).status, 200);
    const d = await cardsRef.doc('infinia').get();
    assert.equal(d.exists, true); assert.equal(d.data().issuer, 'HDFC'); assert.ok(d.data().createdAt && d.data().updatedAt, 'server timestamps are set');
  });
  await check('a second card is appended as its own document, and the list keeps the order added', async () => {
    assert.equal((await call('PUT', '/cards/atlas', { token, body: card('atlas', { issuer: 'Axis', name: 'Atlas' }) })).status, 200);
    assert.equal((await cardsRef.get()).size, 2);
    assert.deepEqual((await call('GET', '/cards', { token })).body.cards.map((c) => c.id), ['infinia', 'atlas']);
  });
  await check('editing one card changes only that document', async () => {
    const before = (await cardsRef.doc('atlas').get()).data();
    assert.equal((await call('PUT', '/cards/infinia', { token, body: card('infinia', { bonusUsed: 1200 }) })).status, 200);
    assert.equal((await cardsRef.doc('infinia').get()).data().bonusUsed, 1200);
    assert.deepEqual((await cardsRef.doc('atlas').get()).data(), before);
  });
  await check('the API never returns Firestore bookkeeping fields', async () => {
    const { cards } = (await call('GET', '/cards', { token })).body;
    assert.ok(cards.every((c) => !('createdAt' in c) && !('updatedAt' in c)));
  });
  await check('bad data is refused and never reaches the database', async () => {
    assert.equal((await call('PUT', '/cards/bad', { token, body: card('bad', { pointsPer: -5 }) })).status, 400);
    assert.equal((await cardsRef.doc('bad').get()).exists, false);
  });
  await check('removing a card deletes its document', async () => {
    assert.equal((await call('DELETE', '/cards/atlas', { token })).status, 200);
    assert.equal((await cardsRef.doc('atlas').get()).exists, false); assert.equal((await cardsRef.get()).size, 1);
  });
  await check('dismissing the pop-up is stored on the user document', async () => {
    assert.equal((await call('POST', '/cards/prompt/dismiss', { token, body: {} })).status, 200);
    assert.equal((await db.collection('users').doc(addr).get()).data().cardsPromptDismissed, true);
    assert.equal((await call('GET', '/cards', { token })).body.promptDismissed, true);
  });
} finally {
  // Remove everything this run created.
  for (const d of (await cardsRef.get()).docs) await d.ref.delete();
  await db.collection('users').doc(addr).delete().catch(() => {});
  await db.collection('authNonces').doc(addr).delete().catch(() => {});
  const left = (await cardsRef.get()).size + ((await db.collection('users').doc(addr).get()).exists ? 1 : 0) + ((await db.collection('authNonces').doc(addr).get()).exists ? 1 : 0);
  console.log(`\nCleanup: ${left === 0 ? 'everything this run created was deleted' : `${left} document(s) left behind for ${addr}`}`);
  if (left) results.push(false);
}
console.log(`\n==== ${results.filter(Boolean).length}/${results.length} checks passed ====`);
process.exit(results.every(Boolean) ? 0 : 1);
