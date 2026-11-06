// World ID v4 NON-mock path, with World's verifier faked (no network, no real credentials).
//   cd backend && npm run test:world
// Proves what we send to World, and that only an explicit success:true for OUR environment is accepted.
// It does NOT prove a real World credential works: that needs the Developer Portal app + World App.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mockResult } from '../test-support/world-mock.mjs';

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'x'.repeat(48),
  VOUCHER_ENC_KEY: 'ab'.repeat(32),
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_MOCK: 'false',
  WORLD_RP_ID: 'rp_test',
  WORLD_RP_SIGNING_KEY: crypto.randomBytes(32).toString('hex'), // throwaway
  WORLD_ENVIRONMENT: 'staging',
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
});

const { createApp } = await import('../src/app.js');
const { upstream } = await import('../src/services/worldid.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}
async function signIn(account) {
  const { body } = await call('POST', '/auth/nonce', { body: { address: account.address } });
  const signature = await account.signMessage({ message: body.message });
  return (await call('POST', '/auth/verify', { body: { address: account.address, signature } })).body.token;
}
const step = (n) => console.log(`  ✓ ${n}`);
const reply = (status, json) => async () => ({ ok: status >= 200 && status < 300, status, json: async () => json });

try {
  let seen;
  const wallet = privateKeyToAccount(generatePrivateKey());
  const token = await signIn(wallet);

  // The server really signs the request (no mock signature) and pins everything the proof must match.
  let { body: request } = await call('POST', '/world-id/request', { token });
  assert.equal(request.rp_context.rp_id, 'rp_test');
  assert.match(request.rp_context.signature, /^0x[0-9a-f]+$/i);
  assert.notEqual(request.rp_context.signature, '0xmock');
  assert.equal(request.signal, wallet.address.toLowerCase());
  assert.equal(request.action, 'netpositive-trader-v1');
  assert.equal(request.environment, 'staging');
  step('signed RP request bound to the wallet');

  const attempt = async (human, fetchImpl) => {
    ({ body: request } = await call('POST', '/world-id/request', { token }));
    upstream.fetch = fetchImpl;
    const result = mockResult({ request, nullifier: human });
    return { result, res: await call('POST', '/world-id/verify', { token, body: result }) };
  };

  // Success: forwarded unchanged to the fixed endpoint, no redirects
  let out = await attempt(777, async (url, init) => { seen = { url, init }; return reply(200, { success: true, environment: 'staging' })(); });
  assert.equal(out.res.status, 200, JSON.stringify(out.res.body));
  assert.equal(seen.url, 'https://developer.world.org/api/v4/verify/rp_test');
  assert.equal(seen.init.redirect, 'error');
  assert.deepEqual(JSON.parse(seen.init.body), out.result);
  step('proof forwarded unchanged to World; success:true accepted');

  // Real IDKit results use DECIMAL strings and may carry extra fields: accepted, and forwarded exactly as received
  {
    const w2 = privateKeyToAccount(generatePrivateKey());
    const t2 = await signIn(w2);
    ({ body: request } = await call('POST', '/world-id/request', { token: t2 }));
    const r = mockResult({ request, nullifier: 7770 });
    r.responses[0].proof = ['1', '2', '3', '4', '5'];
    r.responses[0].nullifier = '123456789012345678901234567890';
    r.responses[0].extra_field = 'x';
    r.session_id = 'ignored';
    upstream.fetch = async (url, init) => { seen = { url, init }; return reply(200, { success: true, environment: 'staging' })(); };
    const ok = await call('POST', '/world-id/verify', { token: t2, body: r });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.deepEqual(JSON.parse(seen.init.body), r, 'forwarded unchanged, extra fields included');
    assert.equal(ok.body.user.worldIdNullifier, '123456789012345678901234567890'); // canonical decimal

    // A malformed shape is refused and the error names the field, never the proof values
    ({ body: request } = await call('POST', '/world-id/request', { token: t2 }));
    const broken = mockResult({ request, nullifier: 7771 });
    broken.responses[0].proof = ['9876543210123456789'];
    const bad = await call('POST', '/world-id/verify', { token: t2, body: broken });
    assert.equal(bad.status, 400);
    assert.ok(bad.body.details.some((d) => d.includes('responses.0.proof')), JSON.stringify(bad.body));
    assert.ok(!JSON.stringify(bad.body).includes('9876543210123456789'));
  }
  step('decimal-string proofs and extra fields accepted; original payload forwarded; bad shape names the field');

  // Refusals (each uses a fresh human so binding rules do not interfere)
  out = await attempt(778, reply(200, { success: false, environment: 'staging' }));
  assert.equal(out.res.body.error, 'world_id_rejected');
  out = await attempt(779, reply(200, { environment: 'staging' }));
  assert.equal(out.res.body.error, 'world_id_rejected'); // success must be explicitly true
  out = await attempt(780, reply(200, { success: true, environment: 'production' }));
  assert.equal(out.res.body.error, 'world_id_rejected'); // wrong environment
  out = await attempt(783, reply(400, { code: 'invalid_proof', detail: 'The proof is invalid' }));
  assert.equal(out.res.status, 403);
  assert.equal(out.res.body.details.code, 'invalid_proof'); // World's reason is passed along
  {
    // World omits `environment`: still accepted (fresh wallet, since `wallet` is already verified above)
    const w3 = privateKeyToAccount(generatePrivateKey());
    const t3 = await signIn(w3);
    ({ body: request } = await call('POST', '/world-id/request', { token: t3 }));
    upstream.fetch = reply(200, { success: true });
    const ok3 = await call('POST', '/world-id/verify', { token: t3, body: mockResult({ request, nullifier: 784 }) });
    assert.equal(ok3.status, 200, JSON.stringify(ok3.body));
  }
  step('success:false, missing success, wrong environment refused');

  out = await attempt(781, reply(500, {}));
  assert.equal(out.res.status, 502);
  out = await attempt(782, async () => { throw new Error('network down'); });
  assert.equal(out.res.status, 502);
  step('World unreachable or erroring → 502, nobody is verified');

  // A refused proof never created an account link
  const me = await call('GET', '/auth/me', { token });
  assert.ok(me.body.user.worldIdNullifier, 'the one successful proof is linked');
  console.log('\nAll World ID upstream checks passed.');
} catch (err) {
  console.error('\nWORLD UPSTREAM TEST FAILED:', err);
  process.exitCode = 1;
} finally {
  server.close();
  setTimeout(() => process.exit(), 200);
}
