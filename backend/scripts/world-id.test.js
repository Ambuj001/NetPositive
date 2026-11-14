// World ID verification against a stand-in for World's verifier (no network). In-memory Firestore.
//   cd backend && node --import ./test-support/register.mjs scripts/world-id.test.js
// Covers the real-world shapes that used to break: World answering without `environment`, decimal vs hex signal hashes,
// unpadded hex nullifiers, World's error bodies, an unusable signing key, and a failed database write.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { hashSignal } from '@worldcoin/idkit-core/hashing';

const RP = 'rp_test0123456789';
const baseEnv = {
  NODE_ENV: 'test', JWT_SECRET: 'x'.repeat(48), VOUCHER_ENC_KEY: 'ab'.repeat(32), FIREBASE_PROJECT_ID: 'demo-netpositive',
  WORLD_ID_APP_ID: 'app_staging_test', WORLD_ID_RP_ID: RP, WORLD_ID_SIGNING_KEY: 'AB'.repeat(32), // upper case, no 0x: must still work
  WORLD_ID_ENV: 'staging', WORLD_ID_MOCK: 'false', WORLD_ID_DEV_BYPASS: 'false', ESCROW_MODE: 'mock', SWEEP_INTERVAL_SECONDS: '0', RATES_REFRESH_SECONDS: '0',
  CORS_ORIGINS: 'https://app.netpositive.example',
};
Object.assign(process.env, baseEnv);

// Stand-in for https://developer.world.org/api/v4/verify/{rp_id}
let world = () => ({ status: 200, body: { success: true } });
const seen = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init) => {
  if (!String(url).startsWith('https://developer.world.org/')) return realFetch(url, init);
  seen.push({ url: String(url), body: JSON.parse(init.body) });
  const r = world();
  if (r.throw) throw new Error(r.throw);
  return new Response(typeof r.body === 'string' ? r.body : JSON.stringify(r.body), { status: r.status, headers: { 'content-type': 'application/json' } });
};

const { createApp } = await import('../src/app.js');
const { col } = await import('../src/services/firestore.js');
const { canonicalNullifier } = await import('../src/services/worldid.js');
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
const call = async (path, body, token, headers = {}) => {
  const r = await fetch(base + path, { method: body === undefined ? 'GET' : 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers }, body: body === undefined ? undefined : JSON.stringify(body) });
  return { status: r.status, json: await r.json().catch(() => ({})) };
};
async function signIn(origin) {
  const acct = privateKeyToAccount(generatePrivateKey());
  const n = await call('/auth/nonce', { address: acct.address }, null, origin ? { origin } : {});
  const v = await call('/auth/verify', { address: acct.address, signature: await acct.signMessage({ message: n.json.message }) });
  assert.equal(v.status, 200, JSON.stringify(v.json));
  return { acct, token: v.json.token, message: n.json.message };
}
const v4 = (address, { nullifier = '123456789', signal = hashSignal(address) } = {}) => ({
  rp_id: RP,
  idkitResponse: { protocol_version: '4.0', nonce: '0x12', action: 'netpositive-account', environment: 'staging', responses: [{ identifier: 'proof_of_human', signal_hash: signal, proof: ['1', '2', '3', '4', '5'], nullifier, issuer_schema_id: 1, expires_at_min: 1 }] },
});
const v3 = (address, nullifier) => ({
  rp_id: RP,
  idkitResponse: { protocol_version: '3.0', nonce: '0x12', action: 'netpositive-account', environment: 'staging', responses: [{ identifier: 'orb', signal_hash: hashSignal(address), proof: '0xabc', merkle_root: '0x1', nullifier }] },
});
const ok = (m) => console.log('  ✓', m);

try {
  // ---- sign-in message is EIP-4361 and names only a trusted site
  {
    const a = await signIn('https://app.netpositive.example');
    assert.match(a.message, /^app\.netpositive\.example wants you to sign in with your Ethereum account:\n0x[0-9a-fA-F]{40}\n/);
    assert.match(a.message, /\nURI: https:\/\/app\.netpositive\.example\nVersion: 1\nChain ID: 5042002\nNonce: [0-9a-f]{32}\nIssued At: .+\nExpiration Time: .+$/);
    assert.ok(a.message.includes(a.acct.address), 'checksummed address');
    const evil = await signIn('https://netpositive-app.evil.example');
    assert.ok(!evil.message.includes('evil'), 'an untrusted origin is never written into the message');
    assert.match(evil.message, /^app\.netpositive\.example wants/);
    ok('sign-in uses the EIP-4361 format, bound to the trusted site, chain and a 5-minute expiry; a look-alike origin is not named');
  }

  // ---- config + request signing
  {
    const cfg = await call('/world-id/config');
    assert.equal(cfg.json.ready, true);
    assert.equal(cfg.json.problem, null);
    const { token } = await signIn();
    const rp = await call('/world-id/rp-signature', { action: 'netpositive-account' }, token);
    assert.equal(rp.status, 200, JSON.stringify(rp.json));
    assert.match(rp.json.sig, /^0x[0-9a-f]{130}$/);
    assert.equal(rp.json.rp_id, RP);
    ok('an upper-case signing key without 0x signs the request');
  }

  // ---- World says success without `environment` (its documented contract) → accepted
  {
    const { acct, token } = await signIn();
    world = () => ({ status: 200, body: { success: true } });
    const r = await call('/world-id/verify', v4(acct.address), token);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    assert.equal(r.json.user.worldIdNullifier, '123456789');
    assert.equal(seen.at(-1).url, `https://developer.world.org/api/v4/verify/${RP}`);
    assert.equal(seen.at(-1).body.protocol_version, '4.0');
    const again = await call('/world-id/verify', v4(acct.address), token);
    assert.equal(again.status, 200, 'same human, same wallet is idempotent');
    ok('World 4 proof: accepted when World answers {success:true} with no environment; forwarded to /api/v4/verify/{rp_id}; idempotent');
  }

  // ---- signal hash as a decimal string, and with odd padding/case
  {
    const { acct, token } = await signIn();
    const dec = BigInt(hashSignal(acct.address)).toString(10);
    const r = await call('/world-id/verify', v4(acct.address, { nullifier: '222', signal: dec }), token);
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const b = await signIn();
    const odd = '0x' + hashSignal(b.acct.address).slice(2).replace(/^0+/, '').toUpperCase();
    const r2 = await call('/world-id/verify', v4(b.acct.address, { nullifier: '333', signal: odd }), b.token);
    assert.equal(r2.status, 200, JSON.stringify(r2.json));
    const c = await signIn();
    const wrong = await call('/world-id/verify', v4(c.acct.address, { nullifier: '444', signal: hashSignal(b.acct.address) }), c.token);
    assert.equal(wrong.status, 400);
    assert.equal(wrong.json.error, 'world_id_signal');
    ok('signal hash is compared as a number (decimal, unpadded and upper-case hex all match); another wallet\'s proof is refused');
  }

  // ---- World ID 3 (legacy) nullifiers: padding and case never make a second human
  {
    assert.equal(canonicalNullifier('0xABC'), '0x' + 'abc'.padStart(64, '0'));
    assert.equal(canonicalNullifier('0x' + 'abc'.padStart(64, '0')), canonicalNullifier('0xABC'));
    assert.equal(canonicalNullifier('00123'), '123');
    const a = await signIn();
    const r = await call('/world-id/verify', v3(a.acct.address, '0x1F' + 'a'.repeat(60)), a.token); // 62 digits: unpadded
    assert.equal(r.status, 200, JSON.stringify(r.json));
    const b = await signIn();
    const dup = await call('/world-id/verify', v3(b.acct.address, '0x001f' + 'A'.repeat(60)), b.token); // same number, other spelling
    assert.equal(dup.status, 409);
    assert.equal(dup.json.error, 'world_id_already_used');
    assert.equal(dup.json.details.linkedWallet, a.acct.address.toLowerCase());
    ok('World ID 3 proof with an unpadded hex nullifier is accepted; the same nullifier in another spelling is the same human (409)');
  }

  // ---- World refuses: its reason reaches the person, never a bare 500
  {
    const { acct, token } = await signIn();
    world = () => ({ status: 400, body: { success: false, code: 'invalid_proof', detail: 'The provided proof is invalid.', attribute: 'proof' } });
    const r = await call('/world-id/verify', v4(acct.address, { nullifier: '555' }), token);
    assert.equal(r.status, 400);
    assert.equal(r.json.error, 'world_id_rejected');
    assert.equal(r.json.message, 'World ID: The provided proof is invalid.');
    assert.equal(r.json.details.code, 'invalid_proof');
    world = () => ({ status: 400, body: { code: 'validation_error', detail: [{ loc: ['responses'], msg: 'x' }] } }); // non-string detail
    const r2 = await call('/world-id/verify', v4(acct.address, { nullifier: '555' }), token);
    assert.equal(r2.status, 400);
    assert.equal(r2.json.message, 'World ID: validation_error');
    world = () => ({ status: 200, body: { success: true, environment: 'production' } });
    const r3 = await call('/world-id/verify', v4(acct.address, { nullifier: '555' }), token);
    assert.equal(r3.status, 400);
    assert.match(r3.json.message, /made for "production".*expects "staging"/);
    world = () => ({ status: 503, body: 'upstream down' });
    const r4 = await call('/world-id/verify', v4(acct.address, { nullifier: '555' }), token);
    assert.equal(r4.status, 502);
    assert.equal(r4.json.error, 'world_id_unreachable');
    world = () => ({ throw: 'getaddrinfo ENOTFOUND' });
    const r5 = await call('/world-id/verify', v4(acct.address, { nullifier: '555' }), token);
    assert.equal(r5.status, 502);
    assert.equal((await call('/auth/me', undefined, token)).json.user.worldIdNullifier, null, 'nothing was linked');
    ok('World\'s refusal reason, a wrong environment, an outage and a network error each give a specific error; nothing is linked');
  }

  // ---- the database write fails after World accepted the proof
  {
    const { acct, token } = await signIn();
    world = () => ({ status: 200, body: { success: true } });
    const original = col.nullifiers.doc;
    col.nullifiers.doc = () => { throw new Error('firestore unavailable'); };
    const silenced = console.error; console.error = () => {};
    const r = await call('/world-id/verify', v4(acct.address, { nullifier: '666' }), token);
    console.error = silenced; col.nullifiers.doc = original;
    assert.ok(r.status >= 500);
    assert.ok(r.json.error === 'world_id_store_failed' || /ref [0-9a-f]{8}/.test(r.json.message), JSON.stringify(r.json));
    const retry = await call('/world-id/verify', v4(acct.address, { nullifier: '666' }), token);
    assert.equal(retry.status, 200, 'a retry works once the database is back');
    ok('a failed save says so (with a reference for the server log) and a retry succeeds');
  }

  // ---- a signing key that is the right length but unusable is reported at startup, not as a 500
  {
    const boot = spawnSync(process.execPath, ['--import', './test-support/register.mjs', '-e', "import('./src/services/worldid.js').then(m=>console.log(JSON.stringify({ready:m.worldIdReady(),problem:m.worldIdProblem()})))"], {
      env: { ...process.env, ...baseEnv, WORLD_ID_SIGNING_KEY: '0x' + '00'.repeat(32) }, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)),
    });
    const out = JSON.parse(boot.stdout.trim().split('\n').at(-1));
    assert.equal(out.ready, false);
    assert.match(out.problem, /WORLD_ID_SIGNING_KEY is not a usable signing key/);
    const badRp = spawnSync(process.execPath, ['--import', './test-support/register.mjs', '-e', "import('./src/services/worldid.js').then(m=>console.log(JSON.stringify({problem:m.worldIdProblem()})))"], {
      env: { ...process.env, ...baseEnv, WORLD_ID_RP_ID: 'app_ee3eaaf80b272b3dff6854c30744dd65' }, encoding: 'utf8', cwd: fileURLToPath(new URL('..', import.meta.url)),
    });
    assert.match(JSON.parse(badRp.stdout.trim().split('\n').at(-1)).problem, /should look like rp_/);
    ok('an unusable signing key, or the app id pasted as the RP id, is reported by /world-id/config instead of failing mid-flow');
  }
  console.log('\nAll World ID checks passed.');
} finally {
  server.close();
}
