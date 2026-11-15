// Admin screen API and the World ID on/off switch. Mock escrow, in-memory database.
//   node --import ./test-support/register.mjs scripts/admin.test.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { mockResult, WORLD_ID_TEST_ENV } from '../test-support/world-v4-mock.mjs';

const admin = privateKeyToAccount(generatePrivateKey());
const user = privateKeyToAccount(generatePrivateKey());
Object.assign(process.env, {
  JWT_SECRET: crypto.randomBytes(48).toString('hex'), VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'), FIREBASE_PROJECT_ID: 'demo-netpositive',
  ...WORLD_ID_TEST_ENV, SWEEP_INTERVAL_SECONDS: '0', RATES_REFRESH_SECONDS: '0', NODE_ENV: 'development', ESCROW_MODE: 'mock',
  ADMIN_ADDRESSES: admin.address, WORLD_ID_REQUIRED: 'false',
});
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const signIn = async (a) => {
  const n = await call('POST', '/auth/nonce', { body: { address: a.address } });
  return (await call('POST', '/auth/verify', { body: { address: a.address, signature: await a.signMessage({ message: n.body.message }) } })).body.token;
};
const order = (token) => call('POST', '/requests', { token, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11.25' } });
const step = (s) => console.log(`  ✓ ${s}`);

try {
  const ta = await signIn(admin), tu = await signIn(user);

  assert.equal((await call('GET', '/admin/me', { token: ta })).body.admin, true);
  assert.equal((await call('GET', '/admin/me', { token: tu })).body.admin, false);
  assert.equal((await call('GET', '/admin/me')).status, 401);
  assert.equal((await call('GET', '/admin/overview', { token: tu })).status, 403);
  assert.equal((await call('PUT', '/admin/settings', { token: tu, body: { worldIdRequired: true } })).status, 403);
  assert.equal((await call('GET', '/admin/overview')).status, 401);
  step('only an administrator wallet reaches the admin API');

  // World ID off (the configured default): a wallet that never verified can trade
  assert.equal((await call('GET', '/world-id/config')).body.required, false);
  let r = await order(tu);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  step('with World ID off, an unverified wallet can create an order');

  r = await call('GET', '/admin/overview', { token: ta });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.settings.worldIdRequired, false);
  assert.equal(r.body.orders.pending_funding, 1);
  assert.equal(r.body.terms.mode, 'mock');
  assert.deepEqual(r.body.server.admins, [admin.address.toLowerCase()]);
  assert.ok(Array.isArray(r.body.disputes));
  step('overview reports settings, terms, order counts and server state');

  // switch it on
  r = await call('PUT', '/admin/settings', { token: ta, body: { worldIdRequired: true } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.settings.worldIdRequired, true);
  assert.equal(r.body.settings.updatedBy, admin.address.toLowerCase());
  assert.equal((await call('GET', '/world-id/config')).body.required, true);
  r = await order(tu);
  assert.equal(r.status, 403); assert.equal(r.body.error, 'world_id_required');
  step('switching it on takes effect at once: the unverified wallet is refused');

  assert.equal((await call('POST', '/world-id/verify', { token: tu, body: mockResult({ address: user.address, nullifier: 99n }) })).status, 200);
  assert.equal((await order(tu)).status, 201);
  step('after verifying, the same wallet can trade again');

  // switch it off again; bad bodies refused
  assert.equal((await call('PUT', '/admin/settings', { token: ta, body: { worldIdRequired: 'yes' } })).status, 400);
  assert.equal((await call('PUT', '/admin/settings', { token: ta, body: { worldIdRequired: false, other: 1 } })).status, 400);
  r = await call('PUT', '/admin/settings', { token: ta, body: { worldIdRequired: false } });
  assert.equal(r.body.settings.worldIdRequired, false);
  const other = privateKeyToAccount(generatePrivateKey());
  assert.equal((await order(await signIn(other))).status, 201);
  step('switching it off again lets unverified wallets in; malformed changes are refused');
  console.log('\nAll admin checks passed.');
} catch (e) {
  console.error('ADMIN TEST FAILED:', e);
  process.exitCode = 1;
} finally {
  server.close();
}
