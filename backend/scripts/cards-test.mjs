// Saved cards: add / edit / remove, isolation between wallets, validation, the 30-card limit (also under a race),
// the "add your cards" pop-up flag, and sign-in rules. In-memory Firestore stand-in, no network.
// Run: npm run cards:test
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { WORLD_ID_TEST_ENV } from '../test-support/world-v4-mock.mjs';

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  ...WORLD_ID_TEST_ENV,
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
});
const { createApp } = await import('../src/app.js');
const { col } = await import('../src/services/firestore.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  PASS  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.message).replace(/\s+/g, ' ').slice(0, 400)}`); }
}
async function call(method, path, { token, body, raw } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: raw ?? (body === undefined ? undefined : JSON.stringify(body)) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: res.status, body: json, text };
}
async function wallet() {
  const acct = privateKeyToAccount(generatePrivateKey());
  const n = await call('POST', '/auth/nonce', { body: { address: acct.address } });
  const v = await call('POST', '/auth/verify', { body: { address: acct.address, signature: await acct.signMessage({ message: n.body.message }) } });
  assert.equal(v.status, 200, v.text);
  return { acct, address: acct.address.toLowerCase(), token: v.body.token };
}
const card = (id = 'infinia', over = {}) => ({
  id, issuer: 'HDFC', name: 'Infinia', last: 'Metal', gradient: '', pointsPer: 5, spendUnit: 150, travelValue: 1, statementValue: 0.3, bonusCap: 3000, bonusUsed: 0,
  channels: [{ id: 'smartbuy', name: 'SmartBuy 5X', multiplier: 5, denomination: 10000, note: 'Accelerated' }, { id: 'direct', name: 'Direct', multiplier: 1, denomination: 10000, note: '' }],
  ...over,
});
const list = async (w) => (await call('GET', '/cards', { token: w.token })).body;

console.log('\nCards tests (in-memory Firestore stand-in)\n');
const A = await wallet(), B = await wallet();

console.log('== 1. Sign-in is required ==');
await check('every cards route is 401 without a token, and with a bad one', async () => {
  for (const t of [undefined, 'garbage', `${A.token}x`]) {
    for (const [m, p, b] of [['GET', '/cards'], ['PUT', '/cards/infinia', card()], ['DELETE', '/cards/infinia'], ['POST', '/cards/prompt/dismiss', {}]]) {
      assert.equal((await call(m, p, { token: t, body: b })).status, 401, `${m} ${p} token=${String(t).slice(0, 6)}`);
    }
  }
});

console.log('\n== 2. Add, read, edit, remove ==');
await check('a new wallet has no cards and has not dismissed the pop-up', async () => {
  assert.deepEqual(await list(A), { cards: [], promptDismissed: false });
});
await check('adding a card stores it under users/{wallet}/cards/{id} and returns it', async () => {
  const r = await call('PUT', '/cards/infinia', { token: A.token, body: card() });
  assert.equal(r.status, 200, r.text); assert.deepEqual(r.body.card, card());
  const stored = await col.users.doc(A.address).collection('cards').doc('infinia').get();
  assert.equal(stored.exists, true); assert.equal(stored.data().issuer, 'HDFC');
});
await check('listing gives the card back with every field and no bookkeeping fields', async () => {
  const { cards } = await list(A);
  assert.deepEqual(cards, [card()]);
  assert.ok(!('createdAt' in cards[0]) && !('updatedAt' in cards[0]));
});
await check('adding the same card twice keeps one copy (safe to repeat)', async () => {
  await call('PUT', '/cards/infinia', { token: A.token, body: card() });
  assert.equal((await list(A)).cards.length, 1);
});
await check('editing replaces the rates, keeps the card where it was in the list', async () => {
  await call('PUT', '/cards/atlas', { token: A.token, body: card('atlas', { issuer: 'Axis', name: 'Atlas' }) });
  await call('PUT', '/cards/infinia', { token: A.token, body: card('infinia', { bonusUsed: 1200, travelValue: 1.5 }) });
  const { cards } = await list(A);
  assert.deepEqual(cards.map((c) => c.id), ['infinia', 'atlas']);
  assert.equal(cards[0].bonusUsed, 1200); assert.equal(cards[0].travelValue, 1.5);
});
await check('text is trimmed before it is stored', async () => {
  await call('PUT', '/cards/trimmed', { token: A.token, body: card('trimmed', { issuer: '  SBI  ', name: ' Cashback ' }) });
  const c = (await list(A)).cards.find((x) => x.id === 'trimmed');
  assert.deepEqual([c.issuer, c.name], ['SBI', 'Cashback']);
});
await check('removing a card deletes it; removing it again is fine', async () => {
  assert.equal((await call('DELETE', '/cards/trimmed', { token: A.token })).status, 200);
  assert.equal((await call('DELETE', '/cards/trimmed', { token: A.token })).status, 200);
  assert.deepEqual((await list(A)).cards.map((c) => c.id), ['infinia', 'atlas']);
  assert.equal((await col.users.doc(A.address).collection('cards').doc('trimmed').get()).exists, false);
});

console.log('\n== 3. Wallets are separate ==');
await check("another wallet sees none of A's cards and gets its own list", async () => {
  assert.deepEqual((await list(B)).cards, []);
  await call('PUT', '/cards/infinia', { token: B.token, body: card('infinia', { issuer: 'B-bank' }) });
  assert.equal((await list(B)).cards[0].issuer, 'B-bank');
  assert.equal((await list(A)).cards.find((c) => c.id === 'infinia').issuer, 'HDFC');
});
await check("removing a card with the same id on B does not touch A's", async () => {
  await call('DELETE', '/cards/infinia', { token: B.token });
  assert.deepEqual((await list(B)).cards, []);
  assert.ok((await list(A)).cards.some((c) => c.id === 'infinia'));
});

console.log('\n== 4. Bad input is refused and nothing is saved ==');
await check('bad card ids (URL and body): spaces, dots, slashes, empty, too long, symbols', async () => {
  for (const id of ['has space', '..', 'a/b', 'a.b', '-lead', 'x'.repeat(65), '<script>', 'üñí']) {
    const r = await call('PUT', `/cards/${encodeURIComponent(id)}`, { token: A.token, body: card(id) });
    assert.ok([400, 404].includes(r.status), `${id}: ${r.status}`);
  }
  assert.equal((await call('DELETE', `/cards/${encodeURIComponent('has space')}`, { token: A.token })).status, 400);
});
await check('body id must match the URL id', async () => {
  const r = await call('PUT', '/cards/one', { token: A.token, body: card('two') });
  assert.equal(r.status, 400); assert.equal(r.body.error, 'id_mismatch');
});
await check('out-of-range numbers, wrong types, unknown fields and bad channels are all rejected', async () => {
  const bad = [
    { pointsPer: -1 }, { pointsPer: 101 }, { spendUnit: 0 }, { spendUnit: 100001 }, { travelValue: 101 }, { statementValue: -0.1 },
    { bonusCap: 10_000_001 }, { bonusUsed: -5 }, { pointsPer: '5' }, { pointsPer: null }, { issuer: '' }, { issuer: '   ' }, { name: 'n'.repeat(81) },
    { last: 'l'.repeat(21) }, { gradient: 'g'.repeat(301) }, { channels: [] }, { channels: 'x' }, { channels: Array.from({ length: 13 }, (_, i) => ({ id: `c${i}`, name: 'n', multiplier: 1, denomination: 100, note: '' })) },
    { channels: [{ id: 'a', name: 'n', multiplier: 101, denomination: 100, note: '' }] },
    { channels: [{ id: 'a', name: 'n', multiplier: 1, denomination: 0, note: '' }] },
    { channels: [{ id: 'a', name: 'n', multiplier: 1, denomination: 1.5, note: '' }] },
    { channels: [{ id: 'a b', name: 'n', multiplier: 1, denomination: 100, note: '' }] },
    { channels: [{ id: 'a', name: 'n', multiplier: 1, denomination: 100, note: '', extra: 1 }] },
    { channels: [{ id: 'a', name: 'n', multiplier: 1, denomination: 100, note: '', instantDiscount: 2 }] },
    { isAdmin: true }, { createdAt: 'x' }, { owner: '0x1' },
  ];
  for (const patch of bad) {
    const r = await call('PUT', '/cards/probe', { token: A.token, body: card('probe', patch) });
    assert.equal(r.status, 400, JSON.stringify(patch).slice(0, 80));
  }
  assert.ok(!(await list(A)).cards.some((c) => c.id === 'probe'));
});
await check('missing fields, a non-object body and invalid JSON are refused', async () => {
  const { pointsPer: _p, ...missing } = card('probe');
  assert.equal((await call('PUT', '/cards/probe', { token: A.token, body: missing })).status, 400);
  assert.equal((await call('PUT', '/cards/probe', { token: A.token, raw: '[1,2]' })).status, 400);
  assert.equal((await call('PUT', '/cards/probe', { token: A.token, raw: '{oops' })).status, 400);
  assert.equal((await call('PUT', '/cards/probe', { token: A.token })).status, 400);
});
await check('a prototype-pollution style body does not become a card field', async () => {
  const r = await call('PUT', '/cards/probe', { token: A.token, raw: JSON.stringify({ ...card('probe'), __proto__: { admin: true } }) });
  assert.ok([200, 400].includes(r.status));
  const c = (await list(A)).cards.find((x) => x.id === 'probe');
  if (c) assert.equal(c.admin, undefined);
  await call('DELETE', '/cards/probe', { token: A.token });
});
await check('a valid minimal card and the boundary values are accepted', async () => {
  const edge = card('edge', { pointsPer: 0, spendUnit: 0.01, travelValue: 100, statementValue: 0, bonusCap: 10_000_000, bonusUsed: 10_000_000, last: '', gradient: 'g'.repeat(300), channels: [{ id: 'a', name: 'n', multiplier: 100, denomination: 10_000_000, note: '', instantDiscount: 1 }] });
  assert.equal((await call('PUT', '/cards/edge', { token: A.token, body: edge })).status, 200);
  await call('DELETE', '/cards/edge', { token: A.token });
});

console.log('\n== 5. The 30-card limit ==');
await check('30 cards fit, the 31st is refused (409), and an existing card can still be edited', async () => {
  const C = await wallet();
  for (let i = 0; i < 30; i++) assert.equal((await call('PUT', `/cards/c${i}`, { token: C.token, body: card(`c${i}`) })).status, 200);
  const over = await call('PUT', '/cards/c30', { token: C.token, body: card('c30') });
  assert.equal(over.status, 409); assert.equal(over.body.error, 'too_many_cards');
  assert.equal((await call('PUT', '/cards/c0', { token: C.token, body: card('c0', { bonusUsed: 7 }) })).status, 200);
  assert.equal((await list(C)).cards.length, 30);
  await call('DELETE', '/cards/c1', { token: C.token });
  assert.equal((await call('PUT', '/cards/c30', { token: C.token, body: card('c30') })).status, 200);
});
await check('35 cards added at the same moment: exactly 30 end up saved', async () => {
  const D = await wallet();
  const rs = await Promise.all(Array.from({ length: 35 }, (_, i) => call('PUT', `/cards/p${i}`, { token: D.token, body: card(`p${i}`) })));
  assert.equal(rs.filter((r) => r.status === 200).length, 30, rs.map((r) => r.status).join());
  assert.equal((await list(D)).cards.length, 30);
});

console.log('\n== 6. The "add your cards" pop-up flag ==');
await check('dismissing is remembered for that wallet only, and repeating it is harmless', async () => {
  const E = await wallet(), F = await wallet();
  assert.equal((await call('POST', '/cards/prompt/dismiss', { token: E.token, body: {} })).status, 200);
  assert.equal((await call('POST', '/cards/prompt/dismiss', { token: E.token, body: {} })).status, 200);
  assert.equal((await list(E)).promptDismissed, true);
  assert.equal((await list(F)).promptDismissed, false);
  assert.equal((await list(E)).cards.length, 0); // dismissing does not add cards
});
await check('dismissing does not disturb saved cards, and saving cards does not set the flag', async () => {
  const G = await wallet();
  await call('PUT', '/cards/infinia', { token: G.token, body: card() });
  assert.equal((await list(G)).promptDismissed, false);
  await call('POST', '/cards/prompt/dismiss', { token: G.token, body: {} });
  assert.deepEqual((await list(G)).cards.map((c) => c.id), ['infinia']);
});

console.log('\n== 7. Banned accounts ==');
await check('a banned wallet cannot read or change cards (403)', async () => {
  const H = await wallet();
  await call('PUT', '/cards/infinia', { token: H.token, body: card() });
  await col.users.doc(H.address).set({ banned: true }, { merge: true });
  for (const [m, p, b] of [['GET', '/cards'], ['PUT', '/cards/atlas', card('atlas')], ['DELETE', '/cards/infinia'], ['POST', '/cards/prompt/dismiss', {}]]) {
    assert.equal((await call(m, p, { token: H.token, body: b })).status, 403, `${m} ${p}`);
  }
});

console.log(`\n==== ${pass}/${pass + fail} checks passed ====`);
server.close();
process.exit(fail ? 1 : 0);
