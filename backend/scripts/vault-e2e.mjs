// End-to-end test of the voucher vault through the real Express app (in-memory Firestore stand-in, escrow mock, World ID mock).
// Proves: the server never holds a readable voucher code, only the requester can open it, and a leak of the whole database
// plus the server's VOUCHER_ENC_KEY exposes nothing.
//
//   node --import ./test-support/register.mjs scripts/vault-e2e.mjs both
//   node --import ./test-support/register.mjs scripts/vault-e2e.mjs sealed
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { recoverMessageAddress } from 'viem';
import * as V from '../vault-sdk/index.js';
import { hashSignal } from '@worldcoin/idkit-core/hashing';

const MODE = process.argv[2] || process.env.VOUCHER_MODE || 'both';
const ENC_KEY = crypto.randomBytes(32).toString('hex');
const adminKeys = V.deriveVaultKeys('0x' + crypto.randomBytes(65).toString('hex'));
Object.assign(process.env, {
  NODE_ENV: 'development', JWT_SECRET: crypto.randomBytes(48).toString('hex'), VOUCHER_ENC_KEY: ENC_KEY,
  FIREBASE_PROJECT_ID: 'demo-netpositive', WORLD_ID_APP_ID: 'app_staging_test', WORLD_ID_ACTION: 'netpositive-account', WORLD_ID_RP_ID: 'rp_test', WORLD_ID_SIGNING_KEY: 'ab'.repeat(32), WORLD_ID_ENV: 'staging', WORLD_ID_MOCK: 'true', ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0', CORS_ORIGINS: 'http://localhost:3000', VOUCHER_MODE: MODE, ADMIN_VAULT_PUBLIC_KEY: adminKeys.publicKeyHex,
});
const { createApp } = await import('../src/app.js');
const { __dump } = await import('../test-support/fake-firestore.mjs');

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`  PASS  ${name}`); }
  catch (e) { results.push(false); console.log(`  FAIL  ${name}\n        ${String(e.message).replace(/\s+/g, ' ').slice(0, 300)}`); }
}
const server = createApp().listen(0);
const BASE = `http://127.0.0.1:${server.address().port}`;
async function api(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: res.status, body: json, text };
}
let nullifierCounter = 1000;
async function login(acct) {
  const n = await api('POST', '/auth/nonce', { body: { address: acct.address } });
  const v = await api('POST', '/auth/verify', { body: { address: acct.address, signature: await acct.signMessage({ message: n.body.message }) } });
  const token = v.body.token;
  // World ID v4 shaped proof (mock mode still checks rp_id, environment, action and that the signal is this wallet).
  const k = ++nullifierCounter;
  const w = await api('POST', '/world-id/verify', { token, body: {
    rp_id: 'rp_test',
    idkitResponse: { protocol_version: '4.0', nonce: `nonce-${k}`, action: 'netpositive-account', environment: 'staging', responses: [{
      identifier: 'proof_of_human', signal_hash: hashSignal(acct.address.toLowerCase()), nullifier: `0x${k.toString(16).padStart(64, '0')}`,
      proof: ['1', '2', '3', '4', '5'], issuer_schema_id: 1, expires_at_min: 1 }] },
  } });
  assert.equal(w.status, 200, `World ID mock verification failed: ${w.text}`);
  return token;
}
const shivam = privateKeyToAccount(generatePrivateKey()); // requester: seller of crypto, receives the voucher
const saad = privateKeyToAccount(generatePrivateKey());   // fulfiller: buys the voucher
const mallory = privateKeyToAccount(generatePrivateKey()); // outsider
const CODE = '9000111122223333', PIN = '424242'; // synthetic test values, not a real voucher
const lc = (a) => a.address.toLowerCase();
let tS, tA, tM, shivamKeys, req, req2;

// What the frontend does for the requester: sign KEY_MESSAGE twice (determinism), derive keys, sign the key binding.
async function setupVault(acct) {
  const s1 = await acct.signMessage({ message: V.KEY_MESSAGE });
  V.assertDeterministicSignature(s1, await acct.signMessage({ message: V.KEY_MESSAGE }));
  const keys = V.deriveVaultKeys(s1);
  const signature = await acct.signMessage({ message: V.keyBindingMessage(acct.address, keys.publicKeyHex) });
  return { keys, signature };
}
async function newFundedAcceptedRequest() {
  const r = await api('POST', '/requests', { token: tS, body: { brand: 'amazon', amountInr: 900, amountUsdc: '10.00' } });
  assert.equal(r.status, 201, r.text);
  const id = r.body.request.id;
  assert.equal((await api('POST', `/requests/${id}/fund`, { token: tS, body: { txHash: `0x${crypto.randomBytes(32).toString('hex')}` } })).status, 200);
  assert.equal((await api('POST', `/requests/${id}/accept`, { token: tA })).status, 200);
  return id;
}
// What the frontend does for the fulfiller: fetch the requester's key, VERIFY its wallet signature, seal.
async function sealAsFulfiller(id, payload, { extraRecipients = [], aadOverride } = {}) {
  const k = (await api('GET', `/vault/key/${lc(shivam)}`, { token: tA })).body.key;
  const who = await recoverMessageAddress({ message: V.keyBindingMessage(k.address, k.publicKey), signature: k.signature });
  assert.equal(who.toLowerCase(), lc(shivam), 'server handed out a key that is not signed by the requester');
  return V.seal(payload, [k.publicKey, ...extraRecipients], aadOverride ?? V.voucherAad(id, lc(shivam), lc(saad)));
}

try {
  console.log(`\nMode: VOUCHER_MODE=${MODE}   (in-memory database, escrow mock, World ID mock)\n`);
  console.log('== 1. Setup ==');
  await check('three wallets sign in', async () => { tS = await login(shivam); tA = await login(saad); tM = await login(mallory); });
  await check('GET /vault/config exposes mode, the message to sign and the dispute public key', async () => {
    const c = (await api('GET', '/vault/config')).body;
    assert.equal(c.mode, MODE); assert.equal(c.keyMessage, V.KEY_MESSAGE); assert.equal(c.adminPublicKey, adminKeys.publicKeyHex);
  });

  console.log('\n== 2. Vault key registration ==');
  let setup;
  await check('submitting a sealed code before the requester has a vault is refused', async () => {
    const id = await newFundedAcceptedRequest(); req2 = id;
    const env = V.seal({ code: CODE, pin: PIN }, [V.deriveVaultKeys(await mallory.signMessage({ message: V.KEY_MESSAGE })).publicKeyHex, adminKeys.publicKeyHex], V.voucherAad(id, lc(shivam), lc(saad)));
    const r = await api('POST', `/requests/${id}/submit-code`, { token: tA, body: { sealed: env } });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.error, 'requester_vault_key_missing');
  });
  await check('a key signed by a DIFFERENT wallet is rejected (a stolen login cannot plant a key)', async () => {
    setup = await setupVault(shivam);
    const forged = await mallory.signMessage({ message: V.keyBindingMessage(shivam.address, setup.keys.publicKeyHex) });
    const r = await api('PUT', '/vault/key', { token: tS, body: { publicKey: setup.keys.publicKeyHex, signature: forged } });
    assert.equal(r.status, 400, r.text); assert.equal(r.body.error, 'bad_key_signature');
  });
  await check('the requester registers their wallet-signed vault key (and repeating it is harmless)', async () => {
    const body = { publicKey: setup.keys.publicKeyHex, signature: setup.signature };
    assert.equal((await api('PUT', '/vault/key', { token: tS, body })).status, 200);
    assert.equal((await api('PUT', '/vault/key', { token: tS, body })).status, 200);
    shivamKeys = setup.keys;
  });
  await check('a different key cannot replace the registered one', async () => {
    const other = V.deriveVaultKeys('0x' + crypto.randomBytes(65).toString('hex'));
    const sig = await shivam.signMessage({ message: V.keyBindingMessage(shivam.address, other.publicKeyHex) });
    const r = await api('PUT', '/vault/key', { token: tS, body: { publicKey: other.publicKeyHex, signature: sig } });
    assert.equal(r.status, 409, r.text); assert.equal(r.body.error, 'vault_key_exists');
  });

  console.log('\n== 3. Sealed submit -> the server cannot read it ==');
  const id = await newFundedAcceptedRequest(); req = id;
  await check('envelope sealed to a key that is NOT the requester\'s is rejected', async () => {
    const wrong = V.deriveVaultKeys('0x' + crypto.randomBytes(65).toString('hex'));
    const env = V.seal({ code: CODE, pin: PIN }, [wrong.publicKeyHex, adminKeys.publicKeyHex], V.voucherAad(id, lc(shivam), lc(saad)));
    const r = await api('POST', `/requests/${id}/submit-code`, { token: tA, body: { sealed: env } });
    assert.equal(r.status, 400, r.text); assert.equal(r.body.error, 'not_sealed_to_requester');
  });
  await check('envelope missing the dispute key is rejected', async () => {
    const env = V.seal({ code: CODE, pin: PIN }, [shivamKeys.publicKeyHex], V.voucherAad(id, lc(shivam), lc(saad)));
    const r = await api('POST', `/requests/${id}/submit-code`, { token: tA, body: { sealed: env } });
    assert.equal(r.status, 400, r.text); assert.equal(r.body.error, 'not_sealed_to_admin');
  });
  await check('malformed envelopes and mixed bodies are rejected', async () => {
    for (const body of [{ sealed: { v: 1 } }, { sealed: 'x' }, { sealed: null }, { sealed: {}, code: 'ABCD1234' }]) {
      const r = await api('POST', `/requests/${id}/submit-code`, { token: tA, body });
      assert.ok([400].includes(r.status), `${JSON.stringify(body).slice(0, 40)} -> ${r.status} ${r.text}`);
    }
  });
  await check('the legacy plaintext path behaves according to VOUCHER_MODE', async () => {
    const id3 = await newFundedAcceptedRequest();
    const r = await api('POST', `/requests/${id3}/submit-code`, { token: tA, body: { code: 'LEGACY-CODE-1', pin: '1' } });
    if (MODE === 'sealed') { assert.equal(r.status, 400, r.text); assert.equal(r.body.error, 'sealed_required'); }
    else {
      assert.equal(r.status, 200, r.text);
      // CONTRAST (why the vault exists): a legacy voucher is readable by anyone holding the database AND the server key.
      const box = Object.entries(__dump()).find(([k]) => k.endsWith(`${id3}/private/voucher`))[1].box;
      const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENC_KEY, 'hex'), Buffer.from(box.iv, 'base64'));
      d.setAAD(Buffer.from(id3)); d.setAuthTag(Buffer.from(box.tag, 'base64'));
      const leaked = Buffer.concat([d.update(Buffer.from(box.ct, 'base64')), d.final()]).toString();
      assert.ok(leaked.includes('LEGACY-CODE-1'), 'expected the legacy design to be readable with the server key');
    }
  });
  await check('a properly sealed code is accepted', async () => {
    const env = await sealAsFulfiller(id, { code: CODE, pin: PIN }, { extraRecipients: [adminKeys.publicKeyHex] });
    const r = await api('POST', `/requests/${id}/submit-code`, { token: tA, body: { sealed: env } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'code_submitted');
  });
  await check('DATABASE LEAK: no copy of the code or PIN exists anywhere in the stored data', async () => {
    const dump = JSON.stringify(__dump());
    assert.ok(!dump.includes(CODE), 'code found in the database'); assert.ok(!dump.includes(PIN + '"'), 'pin found in the database');
    const stored = Object.entries(__dump()).find(([k]) => k.endsWith(`${id}/private/voucher`));
    assert.ok(stored[1].sealed && !stored[1].box, 'stored as sealed envelope, not a server-encrypted box');
  });
  await check('SERVER KEY LEAK: the server\'s VOUCHER_ENC_KEY cannot open the stored sealed voucher', async () => {
    const stored = Object.entries(__dump()).find(([k]) => k.endsWith(`${id}/private/voucher`))[1];
    const attempt = () => { const e = stored.sealed; const d = crypto.createDecipheriv('aes-256-gcm', Buffer.from(ENC_KEY, 'hex'), Buffer.from(e.iv, 'base64')); d.setAuthTag(Buffer.from(e.ct, 'base64').subarray(-16)); d.update(Buffer.from(e.ct, 'base64').subarray(0, -16)); d.final(); };
    assert.throws(attempt);
  });

  console.log('\n== 4. Who can open it ==');
  await check('the requester gets the sealed envelope (no code in the response) and opens it in their own browser', async () => {
    const r = await api('GET', `/requests/${id}/voucher`, { token: tS });
    assert.equal(r.status, 200, r.text);
    assert.ok(!r.text.includes(CODE) && r.body.voucher.sealed);
    assert.deepEqual(V.open(r.body.voucher.sealed, shivamKeys.privateKey, V.voucherAad(id, r.body.voucher.requester, r.body.voucher.fulfiller)), { code: CODE, pin: PIN });
  });
  await check('the fulfiller and outsiders cannot fetch it', async () => {
    assert.equal((await api('GET', `/requests/${id}/voucher`, { token: tA })).status, 403);
    assert.equal((await api('GET', `/requests/${id}/voucher`, { token: tM })).status, 403);
  });
  await check('even holding the envelope, an outsider\'s key and the wrong request context cannot open it', async () => {
    const env = (await api('GET', `/requests/${id}/voucher`, { token: tS })).body.voucher.sealed;
    const m = V.deriveVaultKeys(await mallory.signMessage({ message: V.KEY_MESSAGE }));
    assert.throws(() => V.open(env, m.privateKey, V.voucherAad(id, lc(shivam), lc(saad))));
    assert.throws(() => V.open(env, shivamKeys.privateKey, V.voucherAad(req2, lc(shivam), lc(saad))), undefined, 'wrong request context');
  });
  await check('the offline dispute key can also open it (for judging a dispute), nobody else', async () => {
    const env = (await api('GET', `/requests/${id}/voucher`, { token: tS })).body.voucher.sealed;
    assert.deepEqual(V.open(env, adminKeys.privateKey, V.voucherAad(id, lc(shivam), lc(saad))), { code: CODE, pin: PIN });
  });
  await check('a sealed envelope for the wrong request is accepted by the server (it cannot tell) but the requester\'s client rejects it', async () => {
    const id4 = await newFundedAcceptedRequest();
    const env = await sealAsFulfiller(id4, { code: 'FAKE-1234', pin: '0' }, { extraRecipients: [adminKeys.publicKeyHex], aadOverride: V.voucherAad('someotherrequest', lc(shivam), lc(saad)) });
    assert.equal((await api('POST', `/requests/${id4}/submit-code`, { token: tA, body: { sealed: env } })).status, 200);
    const got = (await api('GET', `/requests/${id4}/voucher`, { token: tS })).body.voucher;
    assert.throws(() => V.open(got.sealed, shivamKeys.privateKey, V.voucherAad(id4, got.requester, got.fulfiller)));
  });

  console.log('\n== 5. The vault: all my vouchers + my own private notes ==');
  const stateBlob = V.encryptState({ redeemed: false, note: 'for Nike shoes' }, shivamKeys.stateKey, V.stateAad(id, lc(shivam)));
  await check('GET /vault lists my sealed vouchers; outsiders see an empty vault', async () => {
    const mine = (await api('GET', '/vault', { token: tS })).body.items;
    const it = mine.find((x) => x.requestId === id);
    assert.ok(it && it.sealed && it.brand === 'amazon' && it.state === null);
    assert.ok(!JSON.stringify(mine).includes(CODE));
    assert.deepEqual((await api('GET', '/vault', { token: tM })).body.items, []);
  });
  await check('I store an encrypted note/"redeemed" flag; the server holds only a blob and returns it', async () => {
    assert.equal((await api('PUT', `/vault/${id}/state`, { token: tS, body: { blob: stateBlob } })).status, 200);
    const it = (await api('GET', '/vault', { token: tS })).body.items.find((x) => x.requestId === id);
    assert.deepEqual(V.decryptState(it.state, shivamKeys.stateKey, V.stateAad(id, lc(shivam))), { redeemed: false, note: 'for Nike shoes' });
    assert.ok(!JSON.stringify(__dump()).includes('for Nike shoes'));
  });
  await check('others cannot write into my vault entry; bad blobs are rejected', async () => {
    assert.equal((await api('PUT', `/vault/${id}/state`, { token: tM, body: { blob: stateBlob } })).status, 403);
    assert.equal((await api('PUT', `/vault/${id}/state`, { token: tS, body: { blob: { v: 1 } } })).status, 400);
    assert.equal((await api('PUT', `/vault/${id}/state`, { token: tS, body: { blob: stateBlob, extra: 1 } })).status, 400);
    assert.equal((await api('PUT', '/vault/abc123/state', { token: tS, body: { blob: stateBlob } })).status, 404);
    assert.equal((await api('PUT', '/vault/not-a-request/state', { token: tS, body: { blob: stateBlob } })).status, 400);
  });
  await check('endpoints need sign-in', async () => {
    for (const [m, p] of [['GET', '/vault'], ['GET', `/vault/key/${lc(shivam)}`], ['PUT', '/vault/key'], ['PUT', `/vault/${id}/state`]]) {
      assert.equal((await api(m, p)).status, 401, `${m} ${p}`);
    }
    assert.equal((await api('GET', '/vault/key/nothex', { token: tS })).status, 400);
    assert.equal((await api('GET', `/vault/key/${lc(mallory)}`, { token: tS })).status, 404); // mallory never set up a vault
  });

  console.log('\n== 6. The rest of the trade still works with a sealed code ==');
  await check('requester confirms -> released, and the sealed voucher stays in the vault afterwards', async () => {
    const c = await api('POST', `/requests/${id}/confirm`, { token: tS });
    assert.equal(c.status, 200, c.text); assert.equal(c.body.request.status, 'released');
    const it = (await api('GET', '/vault', { token: tS })).body.items.find((x) => x.requestId === id);
    assert.equal(it.status, 'released');
    assert.deepEqual(V.open(it.sealed, shivamKeys.privateKey, V.voucherAad(id, it.requester, it.fulfiller)), { code: CODE, pin: PIN });
  });
} finally {
  server.close();
}
const failed = results.filter((r) => !r).length;
console.log(`\n==== ${results.length - failed}/${results.length} checks passed (VOUCHER_MODE=${MODE}) ====`);
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(), 300);
