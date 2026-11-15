// Production hardening: rate limits, the INR/USDC rate check, and the config guards. Mock escrow, in-memory database.
//   node --import ./test-support/register.mjs scripts/hardening.test.js
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts';
import { mockResult, WORLD_ID_TEST_ENV } from '../test-support/world-v4-mock.mjs';

const baseEnv = {
  JWT_SECRET: crypto.randomBytes(48).toString('hex'), VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  FIREBASE_PROJECT_ID: 'demo-netpositive', ...WORLD_ID_TEST_ENV, SWEEP_INTERVAL_SECONDS: '0', RATES_REFRESH_SECONDS: '0',
};

// ---- config guards (child processes; nothing is served)
{
  const boot = (extra) => spawnSync(process.execPath, ['-e', "import('./src/config.js').then(()=>console.log('STARTED'))"], {
    env: { PATH: process.env.PATH, DOTENV_CONFIG_PATH: '/dev/null', ...baseEnv, ...extra }, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)),
  });
  const chain = { ESCROW_MODE: 'chain', ESCROW_CONTRACT_ADDRESS: '0x' + '11'.repeat(20), ESCROW_KEEPER_PRIVATE_KEY: '0x' + '22'.repeat(32) };
  const prod = { NODE_ENV: 'production', WORLD_ID_MOCK: 'false', WORLD_ID_ENV: 'production', ...chain };
  let r = boot({ ...prod, CORS_ORIGINS: 'https://app.example.com' });
  assert.equal(r.status, 0, 'a complete production config starts: ' + r.stderr);
  r = boot({ ...prod, CORS_ORIGINS: '' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /CORS_ORIGINS/);
  r = boot({ ...prod, CORS_ORIGINS: 'http://app.example.com' });
  assert.notEqual(r.status, 0, 'plain http origins are refused in production');
  r = boot({ ...prod, CORS_ORIGINS: 'https://app.example.com', ESCROW_MODE: 'mock' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /mock is not allowed/);
  r = boot({ ...chain, DISPUTE_BOND_USDC: '1' });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /DISPUTE_BOND_USDC/);
  r = boot({ ...chain, ESCROW_ARBITER_PRIVATE_KEY: chain.ESCROW_KEEPER_PRIVATE_KEY });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /different keys/);
  r = boot({ ESCROW_MODE: 'chain', ESCROW_CONTRACT_ADDRESS: '0x' + '11'.repeat(20) });
  assert.notEqual(r.status, 0); assert.match(r.stderr, /ESCROW_KEEPER_PRIVATE_KEY/);
  console.log('  ✓ config guards: production needs https CORS, real escrow, no stake override, separate keys');
}

Object.assign(process.env, baseEnv, { NODE_ENV: 'development', ESCROW_MODE: 'mock', RATE_LIMIT_PER_MINUTE: '40', RATE_LIMIT_WRITES_PER_MINUTE: '6', RATE_MAX_DEVIATION_PCT: '15', CORS_ORIGINS: 'http://localhost:5173' });
const rates = await import('../src/rates/service.js');
const { createApp } = await import('../src/app.js');
const server = createApp().listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
const call = async (method, path, { token, body } = {}) => {
  const res = await fetch(BASE + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: res.status, headers: res.headers, body: await res.json().catch(() => ({})) };
};

try {
  // ---- terms endpoint in mock mode
  let r = await call('GET', '/escrow/terms');
  assert.equal(r.status, 200); assert.equal(r.body.mode, 'mock'); assert.equal(r.body.contract, null); assert.equal(r.body.feeBps, 100);
  console.log('  ✓ /escrow/terms answers in mock mode');

  // ---- the rate check, with the live rate pinned so the test needs no network
  const acct = privateKeyToAccount(generatePrivateKey());
  const n = await call('POST', '/auth/nonce', { body: { address: acct.address } });
  const v = await call('POST', '/auth/verify', { body: { address: acct.address, signature: await acct.signMessage({ message: n.body.message }) } });
  const token = v.body.token;
  assert.equal((await call('POST', '/world-id/verify', { token, body: mockResult({ address: acct.address, nullifier: 4242n }) })).status, 200);
  const realFetch = globalThis.fetch;
  rates.clearRatesCache();
  globalThis.fetch = async (url, init) => (String(url).startsWith(BASE) ? realFetch(url, init) : Promise.reject(new Error('offline in test')));
  r = await call('POST', '/requests', { token, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11.25' } });
  assert.equal(r.status, 201, 'with no live rate the order is allowed (and logged), not blocked: ' + JSON.stringify(r.body));
  globalThis.fetch = realFetch;
  console.log('  ✓ rate check fails open when no live rate is available');

  // ---- write limit: 6 per minute here; sign-in used 3 and the order 1
  let limited = null;
  for (let i = 0; i < 8 && !limited; i++) {
    r = await call('POST', '/auth/nonce', { body: { address: acct.address } });
    if (r.status === 429) limited = r;
  }
  assert.ok(limited, 'writes are limited');
  assert.equal(limited.body.error, 'rate_limited'); assert.ok(Number(limited.headers.get('retry-after')) > 0);
  assert.equal((await call('GET', '/health')).status, 200, 'reads are still served while writes are limited');
  console.log('  ✓ write rate limit answers 429 with Retry-After; reads keep working');

  // ---- overall limit
  let hit = false;
  for (let i = 0; i < 60 && !hit; i++) hit = (await call('GET', '/health')).status === 429;
  assert.ok(hit, 'the overall limit applies to reads too');
  console.log('  ✓ overall rate limit applies');
  console.log('\nAll hardening checks passed.');
} catch (e) {
  console.error('HARDENING TEST FAILED:', e);
  process.exitCode = 1;
} finally {
  server.close();
}
