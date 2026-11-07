// Buy intents: a crypto buyer's "I want to buy USDC for this amount, with this voucher (or none)", matched for spenders.
// In-memory Firestore, mock escrow, no network.
//   cd backend && node --import ./test-support/register.mjs scripts/buy-intents.test.js
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

Object.assign(process.env, {
  JWT_SECRET: 'x'.repeat(48),
  VOUCHER_ENC_KEY: 'ab'.repeat(32),
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_MOCK: 'true',
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
  NODE_ENV: 'test',
});
const { createApp } = await import('../src/app.js');
const { col, Timestamp } = await import('../src/services/firestore.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function signIn(account, { human = true } = {}) {
  const { body } = await call('POST', '/auth/nonce', { body: { address: account.address } });
  const r = await call('POST', '/auth/verify', { body: { address: account.address, signature: await account.signMessage({ message: body.message }) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  if (human) await col.users.doc(account.address.toLowerCase()).update({ worldIdNullifier: '0x' + account.address.slice(2).padStart(64, '0') });
  return r.body.token;
}
const wallet = () => privateKeyToAccount(generatePrivateKey());

try {
  const [a, b, c, d] = [wallet(), wallet(), wallet(), wallet()];
  const [ta, tb, tc, td] = [await signIn(a), await signIn(b), await signIn(c), await signIn(d, { human: false })];

  // ---- create
  let r = await call('POST', '/buy-intents', { token: ta, body: { amountInr: 7300, voucher: 'amazon' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.intent.crypto_buyer, a.address.toLowerCase());
  assert.equal(r.body.intent.amountInr, 7300);
  assert.equal(r.body.intent.voucher, 'amazon');
  assert.ok(r.body.intent.createdAt && r.body.intent.expiresAt);
  assert.equal(Object.keys(r.body.intent).sort().join(), 'amountInr,createdAt,crypto_buyer,expiresAt,id,voucher'); // nothing private leaks
  r = await call('POST', '/buy-intents', { token: tb, body: { amountInr: 7300 } }); // no voucher at all
  assert.equal(r.status, 201);
  assert.equal(r.body.intent.voucher, null);
  r = await call('POST', '/buy-intents', { token: tc, body: { amountInr: 7300, voucher: 'myntra' } });
  assert.equal(r.status, 201);
  console.log('  ✓ create: with a voucher, with none (omitted), no private fields in the response');

  // ---- validation and access
  assert.equal((await call('POST', '/buy-intents', { body: { amountInr: 500 } })).status, 401);
  assert.equal((await call('POST', '/buy-intents', { token: td, body: { amountInr: 500 } })).body.error, 'world_id_required');
  for (const bad of [{ amountInr: 0 }, { amountInr: -5 }, { amountInr: 12.5 }, { amountInr: 100_001 }, { amountInr: '500' }, { amountInr: 500, voucher: 'netflix' }, { amountInr: 500, crypto_buyer: '0x1' }, {}]) {
    const x = await call('POST', '/buy-intents', { token: ta, body: bad });
    assert.equal(x.status, 400, `rejects ${JSON.stringify(bad)}: ${JSON.stringify(x.body)}`);
  }
  assert.equal((await call('GET', '/buy-intents/mine', { token: ta })).body.intent.amountInr, 7300); // rejected posts changed nothing
  console.log('  ✓ needs sign-in and World ID; rejects bad amounts, unknown vouchers, extra fields');

  // ---- matching: amount, then voucher; an intent with no voucher fits any brand
  const match = async (q) => (await call('GET', '/buy-intents?' + new URLSearchParams(q))).body.intents.map((i) => i.crypto_buyer);
  const [A, B, C] = [a, b, c].map((x) => x.address.toLowerCase());
  assert.deepEqual((await match({ amountInr: 7300, brand: 'amazon' })).sort(), [A, B].sort(), 'amazon: the amazon buyer and the no-voucher buyer');
  assert.deepEqual((await match({ amountInr: 7300, brand: 'myntra' })).sort(), [B, C].sort(), 'myntra: the myntra buyer and the no-voucher buyer');
  assert.deepEqual(await match({ amountInr: 7300, brand: 'flipkart' }), [B], 'flipkart: only the no-voucher buyer');
  assert.deepEqual((await match({ amountInr: 7300 })).sort(), [A, B, C].sort(), 'no brand given: amount alone decides');
  assert.deepEqual(await match({ amountInr: 7301, brand: 'amazon' }), [], 'a different amount never matches');
  assert.equal((await call('GET', '/buy-intents?amountInr=abc')).status, 400);
  assert.equal((await call('GET', '/buy-intents?amountInr=500&brand=netflix')).status, 400);
  console.log('  ✓ matching: same amount; same voucher or no voucher; amount alone when no brand is asked for');

  // ---- one intent per wallet: posting again replaces it
  const before = (await call('GET', '/buy-intents/mine', { token: ta })).body.intent;
  r = await call('POST', '/buy-intents', { token: ta, body: { amountInr: 8100, voucher: null } });
  assert.equal(r.status, 201);
  assert.equal(r.body.intent.createdAt, before.createdAt, 'posting time is kept while the intent is live');
  assert.deepEqual(await match({ amountInr: 7300, brand: 'amazon' }), [B], 'the old amount no longer lists them');
  assert.ok((await match({ amountInr: 8100, brand: 'zomato' })).includes(A), 'the new amount does, and no voucher fits any brand');
  assert.equal((await col.buyIntents.where('status', '==', 'active').get()).size, 3, 'still one active intent per wallet');
  console.log('  ✓ posting again replaces the wallet\'s intent (one per wallet) and keeps its posting time');

  // ---- expiry and withdrawing
  await col.buyIntents.doc(B).update({ expiresAt: Timestamp.fromMillis(Date.now() - 1000) });
  assert.deepEqual(await match({ amountInr: 7300, brand: 'myntra' }), [C], 'expired intents are not listed');
  assert.equal((await call('GET', '/buy-intents/mine', { token: tb })).body.intent, null);
  r = await call('DELETE', '/buy-intents/mine', { token: tc });
  assert.equal(r.status, 200);
  assert.deepEqual(await match({ amountInr: 7300, brand: 'myntra' }), [], 'withdrawn intents are not listed');
  assert.equal((await call('DELETE', '/buy-intents/mine', { token: tc })).status, 404, 'nothing left to withdraw');
  r = await call('POST', '/buy-intents', { token: tc, body: { amountInr: 7300, voucher: 'myntra' } }); // can post again after withdrawing
  assert.equal(r.status, 201);
  assert.deepEqual(await match({ amountInr: 7300, brand: 'myntra' }), [C]);
  console.log('  ✓ expired and withdrawn intents drop out; the buyer can post again');

  console.log('\nAll buy-intent checks passed.');
} catch (err) {
  console.error('\nBUY INTENT TEST FAILED:', err);
  process.exitCode = 1;
} finally {
  server.close();
  setTimeout(() => process.exit(), 200);
}
