// WORLD_ID_DEV_BYPASS (local dev only). In-memory Firestore, mock escrow, no network.
//   cd backend && node --import ./test-support/register.mjs scripts/world-bypass.test.js
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const baseEnv = {
  JWT_SECRET: 'x'.repeat(48),
  VOUCHER_ENC_KEY: 'ab'.repeat(32),
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_MOCK: 'false',
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
};

// ---- 1) the guard: the bypass must refuse to start in production, by either route (child processes, nothing is served)
{
  const boot = (extra) => spawnSync(process.execPath, ['-e', "import('./src/config.js').then(()=>console.log('STARTED'))"], {
    env: { ...process.env, DOTENV_CONFIG_PATH: '/dev/null', ...baseEnv, ...extra }, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)),
  });
  const prodNode = boot({ NODE_ENV: 'production', WORLD_ID_DEV_BYPASS: 'true', WORLD_ID_ENV: 'production', ESCROW_MODE: 'chain', ESCROW_CONTRACT_ADDRESS: '0x' + '11'.repeat(20), ESCROW_OPERATOR_PRIVATE_KEY: '0x' + '22'.repeat(32) });
  assert.notEqual(prodNode.status, 0, 'NODE_ENV=production must refuse the bypass');
  assert.match(prodNode.stderr, /not allowed in production/);
  const prodWorld = boot({ NODE_ENV: 'development', WORLD_ID_DEV_BYPASS: 'true', WORLD_ID_ENV: 'production' });
  assert.notEqual(prodWorld.status, 0, 'WORLD_ID_ENV=production must refuse the bypass even in development');
  assert.match(prodWorld.stderr, /not allowed in production/);
  const dev = boot({ NODE_ENV: 'development', WORLD_ID_DEV_BYPASS: 'true', WORLD_ID_ENV: 'staging' });
  assert.equal(dev.status, 0, 'allowed locally: ' + dev.stderr);
  assert.match(dev.stderr, /World ID checks are OFF/); // and it says so loudly
  console.log('  ✓ guard: refused with NODE_ENV=production, refused with WORLD_ID_ENV=production, allowed locally with a warning');
}

// ---- 2) behaviour with the bypass ON
Object.assign(process.env, baseEnv, { NODE_ENV: 'test', WORLD_ID_DEV_BYPASS: 'true', WORLD_ID_ENV: 'staging' });
const { createApp } = await import('../src/app.js');
const { col } = await import('../src/services/firestore.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { token, body } = {}) {
  const res = await fetch(base + path, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json() };
}
async function signIn(account) {
  const { body } = await call('POST', '/auth/nonce', { body: { address: account.address } });
  const r = await call('POST', '/auth/verify', { body: { address: account.address, signature: await account.signMessage({ message: body.message }) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

try {
  assert.equal((await call('GET', '/health')).body.worldIdBypass, true); // visible, never silent

  const a = privateKeyToAccount(generatePrivateKey());
  const b = privateKeyToAccount(generatePrivateKey());
  const [ta, tb] = [await signIn(a), await signIn(b)];

  // before registering, the human-only actions are still locked
  assert.equal((await call('POST', '/requests', { token: ta, body: { brand: 'amazon', amountInr: 500, amountUsdc: '5.6' } })).body.error, 'world_id_required');

  // no proof at all is needed, and TWO different wallets can both register (the original problem)
  let r = await call('POST', '/world-id/verify', { token: ta, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.user.verificationLevel, 'dev_bypass');
  assert.equal((await call('POST', '/world-id/verify', { token: tb })).status, 200);

  // each wallet got its OWN fake person, so one-wallet-per-human still holds underneath
  const na = (await call('GET', '/auth/me', { token: ta })).body.user.worldIdNullifier;
  const nb = (await call('GET', '/auth/me', { token: tb })).body.user.worldIdNullifier;
  assert.match(na, /^0x[0-9a-f]{64}$/);
  assert.notEqual(na, nb);
  // stable: registering again is idempotent and keeps the same identity
  assert.equal((await call('POST', '/world-id/verify', { token: ta, body: {} })).status, 200);
  assert.equal((await call('GET', '/auth/me', { token: ta })).body.user.worldIdNullifier, na);
  // the record is clearly marked as a dev one
  assert.equal((await col.nullifiers.doc(na).get()).data().verificationLevel, 'dev_bypass');

  // registered wallets can now post, and the request flow works as for a real human
  r = await call('POST', '/requests', { token: ta, body: { brand: 'amazon', amountInr: 500, amountUsdc: '5.6' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  console.log('  ✓ bypass: no proof needed, two wallets both register, separate fake identities, idempotent, can post, shown on /health');
  console.log('\nAll bypass checks passed.');
} catch (err) {
  console.error('\nBYPASS TEST FAILED:', err);
  process.exitCode = 1;
} finally {
  server.close();
  setTimeout(() => process.exit(), 200);
}
