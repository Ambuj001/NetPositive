import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import * as V from '../index.js';

const sigOf = (tag) => '0x' + crypto.createHash('sha512').update(tag).digest('hex') + '1b'; // 65 bytes, stands in for a wallet signature
const A = V.deriveVaultKeys(sigOf('alice'));
const B = V.deriveVaultKeys(sigOf('bob'));
const ADMIN = V.deriveVaultKeys(sigOf('admin'));
const aad = V.voucherAad('req1', '0xAAA', '0xBBB');
const secret = { code: '9000111122223333', pin: '424242' }; // synthetic

test('seal then open round-trips', () => {
  const env = V.seal(secret, [A.publicKeyHex], aad);
  assert.deepEqual(V.open(env, A.privateKey, aad), secret);
});

test('envelope contains no plaintext, and is length-padded', () => {
  const env = V.seal(secret, [A.publicKeyHex], aad);
  const s = JSON.stringify(env);
  assert.ok(!s.includes(secret.code) && !s.includes(secret.pin));
  const short = V.seal({ code: 'AB12', pin: null }, [A.publicKeyHex], aad);
  assert.equal(short.ct.length, V.seal({ code: 'x'.repeat(60), pin: null }, [A.publicKeyHex], aad).ct.length, 'short and longer codes look the same size');
});

test('the same payload sealed twice gives different ciphertext', () => {
  const a = V.seal(secret, [A.publicKeyHex], aad), b = V.seal(secret, [A.publicKeyHex], aad);
  assert.notEqual(a.ct, b.ct);
  assert.notEqual(a.recipients[0].epk, b.recipients[0].epk);
});

test('wrong private key cannot open', () => {
  const env = V.seal(secret, [A.publicKeyHex], aad);
  assert.throws(() => V.open(env, B.privateKey, aad), /not sealed to your key/);
});

test('wrong aad (a different request) cannot open: no copying onto another trade', () => {
  const env = V.seal(secret, [A.publicKeyHex], aad);
  assert.throws(() => V.open(env, A.privateKey, V.voucherAad('req2', '0xAAA', '0xBBB')));
});

test('any tampering is detected', () => {
  const env = V.seal(secret, [A.publicKeyHex], aad);
  const flip = (b64) => { const u = V.fromB64(b64); u[0] ^= 1; return V.toB64(u); };
  assert.throws(() => V.open({ ...env, ct: flip(env.ct) }, A.privateKey, aad));
  assert.throws(() => V.open({ ...env, iv: flip(env.iv) }, A.privateKey, aad));
  const r = { ...env.recipients[0], wrapped: flip(env.recipients[0].wrapped) };
  assert.throws(() => V.open({ ...env, recipients: [r] }, A.privateKey, aad));
  const r2 = { ...env.recipients[0], epk: flip(env.recipients[0].epk) };
  assert.throws(() => V.open({ ...env, recipients: [r2] }, A.privateKey, aad));
});

test('two recipients (requester + admin) each open with their own key; a third cannot', () => {
  const env = V.seal(secret, [A.publicKeyHex, ADMIN.publicKeyHex], aad);
  assert.equal(env.recipients.length, 2);
  assert.deepEqual(V.open(env, A.privateKey, aad), secret);
  assert.deepEqual(V.open(env, ADMIN.privateKey, aad), secret);
  assert.throws(() => V.open(env, B.privateKey, aad));
});

test('key derivation is deterministic per signature and differs between signatures', () => {
  assert.equal(V.deriveVaultKeys(sigOf('alice')).publicKeyHex, A.publicKeyHex);
  assert.notEqual(A.publicKeyHex, B.publicKeyHex);
  assert.notEqual(V.toHex(A.privateKey), V.toHex(A.stateKey), 'vault key and state key are separate');
  assert.throws(() => V.deriveVaultKeys('0x1234'));
});

test('non-deterministic wallets are detected', () => {
  V.assertDeterministicSignature(sigOf('a'), sigOf('a'));
  assert.throws(() => V.assertDeterministicSignature(sigOf('a'), sigOf('b')), /non-deterministically/);
});

test('validateEnvelope rejects malformed input', () => {
  const env = V.seal(secret, [A.publicKeyHex], aad);
  for (const bad of [null, [], 'x', {}, { ...env, v: 2 }, { ...env, alg: 'x' }, { ...env, extra: 1 }, { ...env, recipients: [] },
    { ...env, recipients: [env.recipients[0], env.recipients[0]] }, { ...env, iv: 'AAAA' }, { ...env, ct: 'AAAA' },
    { ...env, recipients: [{ ...env.recipients[0], kid: 'nothex' }] }, { ...env, recipients: [{ ...env.recipients[0], extra: 1 }] },
    { ...env, ct: '!!!' }]) {
    assert.throws(() => V.validateEnvelope(bad));
  }
  assert.ok(V.validateEnvelope(env));
  assert.throws(() => V.seal(secret, [], aad));
  assert.throws(() => V.seal(secret, [A.publicKeyHex, B.publicKeyHex, ADMIN.publicKeyHex, A.publicKeyHex], aad));
  assert.throws(() => V.seal({ code: 'x'.repeat(5000) }, [A.publicKeyHex], aad), /too large/);
});

test('vault state is private to the owner key and bound to request+owner', () => {
  const blob = V.encryptState({ redeemed: true, note: 'used on shoes' }, A.stateKey, V.stateAad('req1', '0xAAA'));
  assert.deepEqual(V.decryptState(blob, A.stateKey, V.stateAad('req1', '0xAAA')), { redeemed: true, note: 'used on shoes' });
  assert.throws(() => V.decryptState(blob, B.stateKey, V.stateAad('req1', '0xAAA')));
  assert.throws(() => V.decryptState(blob, A.stateKey, V.stateAad('req2', '0xAAA')));
  assert.ok(V.validateStateBlob(blob));
  assert.throws(() => V.validateStateBlob({ ...blob, extra: 1 }));
});

test('binding message names the address and key', () => {
  const m = V.keyBindingMessage('0xAbC', A.publicKeyHex.toUpperCase());
  assert.ok(m.includes('0xabc') && m.includes(A.publicKeyHex));
});
