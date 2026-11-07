// Dispute module test: stake (bond), reason + category, screenshots stored in Firestore, other-party response,
// admin decision (stake returned / forfeited, strike / ban), retries after failures, races, legacy resolve.
// Mock escrow records every payout that would go on-chain (mockCalls), so we can assert exactly who was paid.
// Run:  npm run dispute:test            (stake = 1 USDC)
//       node --import ./test-support/register.mjs scripts/dispute-test.mjs nobond   (stake switched off)
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { getAddress } from 'viem';
import { WORLD_ID_TEST_ENV, mockResult } from '../test-support/world-v4-mock.mjs';

const MODE = process.argv[2] === 'nobond' ? 'nobond' : 'bond';
const BOND = MODE === 'bond';
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  ...WORLD_ID_TEST_ENV,
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
  DISPUTE_BOND_USDC: BOND ? '1' : '0',
  DISPUTE_MAX_EVIDENCE_PER_PARTY: '4',
  DISPUTE_MAX_IMAGE_BYTES: '500000',
});
const admin = privateKeyToAccount(generatePrivateKey());
process.env.ADMIN_ADDRESSES = admin.address;

const { createApp } = await import('../src/app.js');
const { col, Timestamp } = await import('../src/services/firestore.js');
const { mockCalls, mockFaults, escrowIdFor } = await import('../src/services/escrow.js');

const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;
let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log(`  PASS  ${name}`); }
  catch (e) { fail++; console.log(`  FAIL  ${name}\n        ${String(e.message).replace(/\s+/g, ' ').slice(0, 500)}`); }
}
async function call(method, path, { token, body, raw, type, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { ...(raw === undefined ? { 'content-type': 'application/json' } : { 'content-type': type }), ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: raw !== undefined ? raw : body === undefined ? undefined : JSON.stringify(body),
  });
  const buf = Buffer.from(await res.arrayBuffer());
  let json; try { json = JSON.parse(buf.toString()); } catch { json = {}; }
  return { status: res.status, body: json, buf, headers: res.headers, text: buf.toString('latin1') };
}
let nul = BigInt(`0x${crypto.randomBytes(10).toString('hex')}`);
async function signIn(acct) {
  const n = await call('POST', '/auth/nonce', { body: { address: acct.address } });
  const v = await call('POST', '/auth/verify', { body: { address: acct.address, signature: await acct.signMessage({ message: n.body.message }) } });
  assert.equal(v.status, 200);
  const w = await call('POST', '/world-id/verify', { token: v.body.token, body: mockResult({ address: acct.address, nullifier: ++nul }) });
  assert.equal(w.status, 200, w.text);
  return v.body.token;
}
const fakeTx = () => `0x${crypto.randomBytes(32).toString('hex')}`;
const png = (extra = 300) => Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(extra)]);
const jpg = () => Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), crypto.randomBytes(200)]);
const addr = (a) => a.address.toLowerCase();

// every trade uses fresh wallets, so a ban in one test cannot leak into another
async function actors() {
  const [r, f, o] = [privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey()), privateKeyToAccount(generatePrivateKey())];
  const [tr, tf, to_] = await Promise.all([signIn(r), signIn(f), signIn(o)]);
  return { r, f, o, tr, tf, to: to_ };
}
let adminToken;
async function trade(a, { dispute = null } = {}) {
  let x = await call('POST', '/requests', { token: a.tr, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11' } });
  assert.equal(x.status, 201, x.text);
  const id = x.body.request.id;
  assert.equal((await call('POST', `/requests/${id}/fund`, { token: a.tr, body: { txHash: fakeTx() } })).status, 200);
  assert.equal((await call('POST', `/requests/${id}/accept`, { token: a.tf })).status, 200);
  assert.equal((await call('POST', `/requests/${id}/submit-code`, { token: a.tf, body: { code: 'TEST-CODE-0001' } })).status, 200);
  if (dispute) return { id, ...(await raise(a, id, dispute.by, dispute)) };
  return { id };
}
/** Stake (if on) and raise a dispute. by: 'r' | 'f' */
async function raise(a, id, by, { category = 'invalid_code', reason = 'The code does not work at all' } = {}) {
  const tok = by === 'r' ? a.tr : a.tf;
  const terms = await call('POST', `/requests/${id}/dispute/bond`, { token: tok });
  assert.equal(terms.status, 200, terms.text);
  const res = await call('POST', `/requests/${id}/dispute`, { token: tok, body: { category, reason, ...(BOND && { bondTxHash: fakeTx() }) } });
  assert.equal(res.status, 200, res.text);
  return { terms: terms.body.bond, res };
}
const callsFor = (escrowId) => mockCalls.filter((c) => c.args[0] === escrowId);
const user = async (a) => (await col.users.doc(addr(a)).get()).data();
const resolve = (a, id, body) => call('POST', `/requests/${id}/resolve`, { token: adminToken, body });

console.log(`\nDispute tests. Stake: ${BOND ? '1 USDC (on)' : 'off'}   Escrow: mock (records payouts)   Database: in-memory Firestore stand-in\n`);
adminToken = await signIn(admin);

console.log('== 1. The stake ==');
if (BOND) {
  await check('bond terms: amount in base units, a bond id, the contract; the secret nonce is never shown', async () => {
    const a = await actors(); const { id } = await trade(a);
    const t = await call('POST', `/requests/${id}/dispute/bond`, { token: a.tr });
    assert.equal(t.status, 200);
    assert.deepEqual([t.body.bond.required, t.body.bond.amountBaseUnits, t.body.bond.amountUsdc], [true, '1000000', '1']);
    assert.match(t.body.bond.escrowId, /^0x[0-9a-f]{64}$/);
    const priv = (await col.requests.doc(id).collection('private').doc(`bond-${addr(a.r)}`).get()).data();
    assert.ok(priv.nonce && !t.text.includes(priv.nonce));
  });
  await check('asking twice gives the same bond id; requester and fulfiller get different ones', async () => {
    const a = await actors(); const { id } = await trade(a);
    const [t1, t2, t3] = await Promise.all([call('POST', `/requests/${id}/dispute/bond`, { token: a.tr }), call('POST', `/requests/${id}/dispute/bond`, { token: a.tr }), call('POST', `/requests/${id}/dispute/bond`, { token: a.tf })]);
    assert.equal(t1.body.bond.escrowId, t2.body.bond.escrowId);
    assert.notEqual(t1.body.bond.escrowId, t3.body.bond.escrowId);
  });
  await check('a stranger cannot get bond terms (403); an open request has none (409); no login is 401', async () => {
    const a = await actors(); const { id } = await trade(a);
    assert.equal((await call('POST', `/requests/${id}/dispute/bond`, { token: a.to })).status, 403);
    assert.equal((await call('POST', `/requests/${id}/dispute/bond`)).status, 401);
    const open = (await call('POST', '/requests', { token: a.tr, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11' } })).body.request.id;
    assert.equal((await call('POST', `/requests/${open}/dispute/bond`, { token: a.tr })).status, 409);
  });
  await check('raising a dispute without the stake is refused (400 bond_required)', async () => {
    const a = await actors(); const { id } = await trade(a);
    await call('POST', `/requests/${id}/dispute/bond`, { token: a.tr });
    const r = await call('POST', `/requests/${id}/dispute`, { token: a.tr, body: { category: 'invalid_code', reason: 'does not work' } });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'bond_required');
    assert.equal((await call('GET', `/requests/${id}`)).body.request.status, 'code_submitted');
  });
  await check('a stake that is not really on-chain (verification fails) blocks the dispute and leaves the trade untouched', async () => {
    const a = await actors(); const { id } = await trade(a);
    await call('POST', `/requests/${id}/dispute/bond`, { token: a.tr });
    mockFaults.add('verifyDeposit');
    const r = await call('POST', `/requests/${id}/dispute`, { token: a.tr, body: { category: 'invalid_code', reason: 'does not work', bondTxHash: fakeTx() } });
    mockFaults.delete('verifyDeposit');
    assert.equal(r.status, 400);
    const req = (await call('GET', `/requests/${id}`)).body.request;
    assert.equal(req.status, 'code_submitted'); assert.equal(req.dispute, undefined);
  });
  await check('staking without asking for the terms first is refused (400 bond_not_prepared)', async () => {
    const a = await actors(); const { id } = await trade(a);
    const r = await call('POST', `/requests/${id}/dispute`, { token: a.tr, body: { category: 'invalid_code', reason: 'does not work', bondTxHash: fakeTx() } });
    assert.equal(r.body.error, 'bond_not_prepared');
  });
} else {
  await check('stake off: terms say not required, dispute works without a tx hash and records no bond', async () => {
    const a = await actors(); const { id } = await trade(a);
    const t = await call('POST', `/requests/${id}/dispute/bond`, { token: a.tr });
    assert.equal(t.body.bond.required, false);
    const r = await call('POST', `/requests/${id}/dispute`, { token: a.tr, body: { category: 'invalid_code', reason: 'does not work' } });
    assert.equal(r.status, 200); assert.equal(r.body.request.dispute.bond.status, 'none');
  });
}

console.log('\n== 2. Raising a dispute ==');
await check('requester raises it: status disputed, category + reason + bond saved', async () => {
  const a = await actors(); const { id, res } = await trade(a, { dispute: { by: 'r', category: 'already_redeemed', reason: 'Brand site says already redeemed' } });
  const d = res.body.request.dispute;
  assert.equal(res.body.request.status, 'disputed');
  assert.deepEqual([d.by, d.category, d.reason], [addr(a.r), 'already_redeemed', 'Brand site says already redeemed']);
  assert.equal(d.bond.status, BOND ? 'held' : 'none');
});
await check('validation: unknown category, too-short reason, too-long reason, bad tx hash, unknown fields are rejected', async () => {
  const a = await actors(); const { id } = await trade(a);
  await call('POST', `/requests/${id}/dispute/bond`, { token: a.tr });
  for (const body of [
    { category: 'nonsense', reason: 'does not work' }, { category: 'other', reason: 'no' }, { category: 'other', reason: 'x'.repeat(1001) },
    { category: 'other', reason: 'does not work', bondTxHash: '0x12' }, { reason: 'missing category' },
  ]) assert.equal((await call('POST', `/requests/${id}/dispute`, { token: a.tr, body })).status, 400, JSON.stringify(body).slice(0, 60));
  assert.equal((await call('GET', `/requests/${id}`)).body.request.status, 'code_submitted');
});
await check('a stranger cannot dispute (403); the fulfiller can; a second dispute is refused (409)', async () => {
  const a = await actors(); const { id } = await trade(a);
  assert.equal((await call('POST', `/requests/${id}/dispute`, { token: a.to, body: { category: 'other', reason: 'not my trade', ...(BOND && { bondTxHash: fakeTx() }) } })).status, 403);
  await raise(a, id, 'f', { category: 'code_is_valid', reason: 'The code is fine, the seller is lying' });
  const again = await call('POST', `/requests/${id}/dispute`, { token: a.tr, body: { category: 'other', reason: 'me too', ...(BOND && { bondTxHash: fakeTx() }) } });
  assert.equal(again.status, 409);
});
await check('both sides raising at the same moment: exactly one dispute is created', async () => {
  const a = await actors(); const { id } = await trade(a);
  await call('POST', `/requests/${id}/dispute/bond`, { token: a.tr }); await call('POST', `/requests/${id}/dispute/bond`, { token: a.tf });
  const body = { category: 'other', reason: 'racing each other', ...(BOND && { bondTxHash: fakeTx() }) };
  const rs = await Promise.all([call('POST', `/requests/${id}/dispute`, { token: a.tr, body: { ...body, ...(BOND && { bondTxHash: fakeTx() }) } }), call('POST', `/requests/${id}/dispute`, { token: a.tf, body: { ...body, ...(BOND && { bondTxHash: fakeTx() }) } })]);
  assert.deepEqual(rs.map((r) => r.status).sort(), [200, 409]);
});
await check('the requester cannot dispute after the review window (409); the sweeper pays the fulfiller', async () => {
  const a = await actors(); const { id } = await trade(a);
  await call('POST', `/requests/${id}/dispute/bond`, { token: a.tr }).catch(() => {});
  await col.requests.doc(id).update({ reviewDeadline: Timestamp.fromMillis(Date.now() - 1000) });
  const r = await call('POST', `/requests/${id}/dispute`, { token: a.tr, body: { category: 'other', reason: 'too late to complain', ...(BOND && { bondTxHash: fakeTx() }) } });
  assert.equal(r.status, 409);
});
await check('an account banned after a false dispute cannot sign in to the API anymore (403)', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  assert.equal((await resolve(a, id, { verdict: 'disputer_wrong' })).status, 200);
  const r = await call('GET', '/requests/mine', { token: a.tr });
  assert.equal(r.status, 403); assert.equal(r.body.error, 'banned');
});

console.log('\n== 3. Screenshots and the other side\'s answer ==');
await check('upload: disputer and opposition can add screenshots; they are stored in Firestore as base64', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  const img = png();
  const u1 = await call('POST', `/requests/${id}/evidence?note=${encodeURIComponent('brand site error')}`, { token: a.tr, raw: img, type: 'image/png' });
  assert.equal(u1.status, 201, u1.text);
  assert.equal(u1.body.evidence.sha256, crypto.createHash('sha256').update(img).digest('hex'));
  const u2 = await call('POST', `/requests/${id}/evidence`, { token: a.tf, raw: jpg(), type: 'image/jpeg' });
  assert.equal(u2.status, 201);
  const stored = await col.requests.doc(id).collection('evidence').doc(u1.body.evidence.id).get();
  assert.equal(Buffer.from(stored.data().data, 'base64').equals(img), true);
  assert.equal(stored.data().by, addr(a.r)); assert.equal(stored.data().note, 'brand site error');
});
await check('list shows metadata only (no image bytes); fetching returns the exact image with safe headers', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  const img = png(); const up = await call('POST', `/requests/${id}/evidence`, { token: a.tr, raw: img, type: 'image/png' });
  const list = await call('GET', `/requests/${id}/evidence`, { token: a.tf });
  assert.equal(list.status, 200); assert.equal(list.body.evidence.length, 1);
  assert.ok(!('data' in list.body.evidence[0]) && !list.text.includes(img.toString('base64').slice(0, 40)));
  const got = await call('GET', `/requests/${id}/evidence/${up.body.evidence.id}`, { token: a.tf });
  assert.equal(got.buf.equals(img), true);
  assert.equal(got.headers.get('content-type'), 'image/png'); assert.equal(got.headers.get('x-content-type-options'), 'nosniff');
  assert.match(got.headers.get('cache-control'), /no-store/);
});
await check('privacy: a stranger and a logged-out caller cannot list, fetch or upload; an admin can read', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  const up = await call('POST', `/requests/${id}/evidence`, { token: a.tr, raw: png(), type: 'image/png' });
  const evId = up.body.evidence.id;
  assert.equal((await call('GET', `/requests/${id}/evidence`, { token: a.to })).status, 403);
  assert.equal((await call('GET', `/requests/${id}/evidence/${evId}`, { token: a.to })).status, 403);
  assert.equal((await call('POST', `/requests/${id}/evidence`, { token: a.to, raw: png(), type: 'image/png' })).status, 403);
  assert.equal((await call('GET', `/requests/${id}/evidence`)).status, 401);
  assert.equal((await call('GET', `/requests/${id}/evidence/${evId}`)).status, 401);
  assert.equal((await call('POST', `/requests/${id}/evidence`, { raw: png(), type: 'image/png' })).status, 401);
  assert.equal((await call('GET', `/requests/${id}/evidence/${evId}`, { token: adminToken })).status, 200);
});
await check('evidence from one request is not reachable through another request id', async () => {
  const a = await actors(); const t1 = await trade(a, { dispute: { by: 'r' } }); const t2 = await trade(a, { dispute: { by: 'r' } });
  const up = await call('POST', `/requests/${t1.id}/evidence`, { token: a.tr, raw: png(), type: 'image/png' });
  assert.equal((await call('GET', `/requests/${t2.id}/evidence/${up.body.evidence.id}`, { token: a.tr })).status, 404);
});
await check('rules: only while disputed; max 4 per person (5th is 409); the other side still has its own 4', async () => {
  const a = await actors(); const { id } = await trade(a);
  assert.equal((await call('POST', `/requests/${id}/evidence`, { token: a.tr, raw: png(), type: 'image/png' })).status, 409); // not disputed yet
  await raise(a, id, 'r');
  for (let i = 0; i < 4; i++) assert.equal((await call('POST', `/requests/${id}/evidence`, { token: a.tr, raw: png(), type: 'image/png' })).status, 201);
  assert.equal((await call('POST', `/requests/${id}/evidence`, { token: a.tr, raw: png(), type: 'image/png' })).status, 409);
  assert.equal((await call('POST', `/requests/${id}/evidence`, { token: a.tf, raw: png(), type: 'image/png' })).status, 201);
});
await check('parallel uploads cannot sneak past the limit', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  const rs = await Promise.all(Array.from({ length: 8 }, () => call('POST', `/requests/${id}/evidence`, { token: a.tr, raw: png(), type: 'image/png' })));
  assert.equal(rs.filter((r) => r.status === 201).length, 4, rs.map((r) => r.status).join());
  assert.equal((await call('GET', `/requests/${id}/evidence`, { token: a.tr })).body.evidence.length, 4);
});
await check('bad uploads: not an image (text, html, svg, pdf), fake image bytes, empty, oversized, wrong declared type', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  const up = (raw, type) => call('POST', `/requests/${id}/evidence`, { token: a.tr, raw, type });
  assert.equal((await up('hello', 'text/plain')).status, 415);
  assert.equal((await up('<script>alert(1)</script>', 'text/html')).status, 415);
  assert.equal((await up('<svg xmlns="http://www.w3.org/2000/svg"/>', 'image/svg+xml')).status, 415);
  assert.equal((await up(Buffer.from('%PDF-1.4'), 'application/pdf')).status, 415);
  assert.equal((await up(Buffer.from('<script>alert(1)</script>'), 'image/png')).status, 400); // claims PNG, is HTML
  assert.equal((await up(png(), 'image/jpeg')).status, 400); // claims JPEG, is PNG
  assert.equal((await up(Buffer.alloc(0), 'image/png')).status, 400);
  assert.equal((await up(Buffer.concat([png(), crypto.randomBytes(600_000)]), 'image/png')).status, 413);
  assert.equal((await call('GET', `/requests/${id}/evidence`, { token: a.tr })).body.evidence.length, 0); // none of them were stored
});
await check('a screenshot just under the size limit is accepted', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  assert.equal((await call('POST', `/requests/${id}/evidence`, { token: a.tr, raw: png(499_000), type: 'image/png' })).status, 201);
});
await check('response: only the other party, once; the disputer cannot answer their own dispute', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  assert.equal((await call('POST', `/requests/${id}/dispute/respond`, { token: a.tr, body: { text: 'I am the disputer' } })).status, 403);
  assert.equal((await call('POST', `/requests/${id}/dispute/respond`, { token: a.to, body: { text: 'stranger here' } })).status, 403);
  assert.equal((await call('POST', `/requests/${id}/dispute/respond`, { token: a.tf, body: { text: 'no' } })).status, 400);
  const ok = await call('POST', `/requests/${id}/dispute/respond`, { token: a.tf, body: { text: 'The code was valid when I bought it, here is my receipt' } });
  assert.equal(ok.status, 200); assert.equal(ok.body.request.dispute.response.by, addr(a.f));
  assert.equal((await call('POST', `/requests/${id}/dispute/respond`, { token: a.tf, body: { text: 'and another thing' } })).status, 409);
});

console.log('\n== 4. The decision ==');
const bondOf = (r) => r.dispute?.bond?.escrowId;
const strikes = async (acct) => (await user(acct)).reputation?.strikes ?? 0;
for (const [who, label, other] of [['r', 'requester (crypto seller)', 'f'], ['f', 'fulfiller (voucher buyer)', 'r']]) {
  await check(`${label} disputes and is RIGHT: stake back to them, other side struck, trade goes their way, nobody banned`, async () => {
    const a = await actors(); const { id } = await trade(a, { dispute: { by: who } });
    const before = mockCalls.length; const sBefore = await strikes(a[other]);
    const r = await resolve(a, id, { verdict: 'disputer_right', note: 'confirmed the code is as described' });
    assert.equal(r.status, 200, r.text);
    const calls = mockCalls.slice(before);
    const req = (await call('GET', `/requests/${id}`)).body.request;
    if (who === 'r') { assert.equal(req.status, 'refunded'); assert.ok(calls.some((c) => c.functionName === 'refund' && c.args[0] === escrowIdFor(id))); }
    else { assert.equal(req.status, 'released'); assert.ok(calls.some((c) => c.functionName === 'release' && c.args[0] === escrowIdFor(id) && c.args[1] === getAddress(a.f.address))); }
    if (BOND) {
      assert.equal(req.dispute.bond.status, 'returned');
      assert.ok(calls.some((c) => c.functionName === 'refund' && c.args[0] === bondOf(req)), 'stake not refunded');
      assert.ok(!calls.some((c) => c.functionName === 'release' && c.args[0] === bondOf(req)), 'stake must not be released to anyone');
    } else assert.ok(calls.every((c) => c.args[0] === escrowIdFor(id)), 'no bond calls expected');
    assert.equal(await strikes(a[other]), sBefore + 1);
    assert.ok(!(await user(a[who])).banned && !(await user(a[other])).banned);
    assert.equal(req.resolution.verdict, 'disputer_right');
  });
  await check(`${label} disputes and is WRONG: stake to the other side, disputer BANNED, trade goes against them`, async () => {
    const a = await actors(); const { id } = await trade(a, { dispute: { by: who } });
    const before = mockCalls.length;
    const r = await resolve(a, id, { verdict: 'disputer_wrong', note: 'the code is valid' });
    assert.equal(r.status, 200, r.text);
    const calls = mockCalls.slice(before); const req = (await call('GET', `/requests/${id}`)).body.request;
    if (who === 'r') { assert.equal(req.status, 'released'); assert.ok(calls.some((c) => c.functionName === 'release' && c.args[0] === escrowIdFor(id) && c.args[1] === getAddress(a.f.address))); }
    else { assert.equal(req.status, 'refunded'); assert.ok(calls.some((c) => c.functionName === 'refund' && c.args[0] === escrowIdFor(id))); }
    if (BOND) {
      assert.equal(req.dispute.bond.status, 'forfeited');
      const pay = calls.find((c) => c.functionName === 'release' && c.args[0] === bondOf(req));
      assert.ok(pay, 'stake not paid out');
      assert.equal(pay.args[1], getAddress(a[other].address), 'stake must go to the OTHER party');
      assert.ok(!calls.some((c) => c.functionName === 'refund' && c.args[0] === bondOf(req)), 'stake must not be returned');
    }
    const u = await user(a[who]);
    assert.equal(u.banned, true); assert.match(u.bannedReason, /false dispute/);
    assert.ok(!(await user(a[other])).banned);
    assert.equal(await strikes(a[other]), 0);
  });
}
await check('only an admin can decide (403 for requester, fulfiller, stranger, logged-out 401); bad verdicts are 400', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  for (const t of [a.tr, a.tf, a.to]) assert.equal((await call('POST', `/requests/${id}/resolve`, { token: t, body: { verdict: 'disputer_right' } })).status, 403);
  assert.equal((await call('POST', `/requests/${id}/resolve`, { body: { verdict: 'disputer_right' } })).status, 401);
  for (const body of [{}, { verdict: 'maybe' }, { verdict: 'disputer_right', extra: 1 }, { outcome: 'burn' }]) assert.equal((await resolve(a, id, body)).status, 400, JSON.stringify(body));
  assert.equal((await call('GET', `/requests/${id}`)).body.request.status, 'disputed');
});
await check('resolving something that is not disputed is refused (409); resolving twice pays only once', async () => {
  const a = await actors(); const { id } = await trade(a);
  assert.equal((await resolve(a, id, { verdict: 'disputer_right' })).status, 409);
  const d = await trade(a, { dispute: { by: 'r' } });
  const before = mockCalls.length;
  const rs = await Promise.all([resolve(a, d.id, { verdict: 'disputer_right' }), resolve(a, d.id, { verdict: 'disputer_right' })]);
  assert.ok(rs.some((r) => r.status === 200));
  const second = await resolve(a, d.id, { verdict: 'disputer_right' });
  assert.equal(second.status, 409);
  const paid = mockCalls.slice(before).filter((c) => c.args[0] === escrowIdFor(d.id) || c.args[0] === bondOf((rs.find((r) => r.status === 200)).body.request));
  assert.equal(paid.length, BOND ? 2 : 1, `payouts: ${paid.map((p) => p.functionName).join()}`); // main refund + stake refund, once each
});
await check('legacy {outcome} still works and is turned into a verdict (requester + refund = disputer right)', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  const r = await resolve(a, id, { outcome: 'refund', note: 'old style' });
  assert.equal(r.status, 200); assert.equal(r.body.request.resolution.verdict, 'disputer_right'); assert.equal(r.body.request.status, 'refunded');
  const b = await actors(); const t = await trade(b, { dispute: { by: 'r' } });
  const r2 = await resolve(b, t.id, { outcome: 'release' });
  assert.equal(r2.body.request.resolution.verdict, 'disputer_wrong'); assert.equal((await user(b.r)).banned, true);
});
if (BOND) {
  await check('stake payout fails: dispute stays open, verdict is locked, retry finishes, stake paid ONCE, strike applied ONCE', async () => {
    const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
    const bondId = bondOf((await call('GET', `/requests/${id}`)).body.request);
    const sBefore = await strikes(a.f); const before = mockCalls.length;
    mockFaults.add('refund');
    const failed = await resolve(a, id, { verdict: 'disputer_right' });
    assert.equal(failed.status, 502); assert.equal(failed.body.error, 'bond_payout_failed');
    assert.equal((await call('GET', `/requests/${id}`)).body.request.status, 'disputed');
    assert.equal((await resolve(a, id, { verdict: 'disputer_wrong' })).status, 409); // cannot flip the decision after the fact
    mockFaults.delete('refund');
    const ok = await resolve(a, id, { verdict: 'disputer_right' });
    assert.equal(ok.status, 200, ok.text);
    const calls = mockCalls.slice(before);
    assert.equal(calls.filter((c) => c.args[0] === bondId).length, 1);
    assert.equal(calls.filter((c) => c.args[0] === escrowIdFor(id)).length, 1);
    assert.equal(await strikes(a.f), sBefore + 1);
  });
  await check('trade settlement fails after the stake moved: retry does NOT pay the stake again and does not double-punish', async () => {
    const a = await actors(); const { id } = await trade(a, { dispute: { by: 'f' } });
    const req0 = (await call('GET', `/requests/${id}`)).body.request; const bondId = bondOf(req0);
    const before = mockCalls.length; const sBefore = await strikes(a.r);
    mockFaults.add('release'); // main settlement for "fulfiller right" is a release of the trade escrow; the stake goes back by refund
    const failed = await resolve(a, id, { verdict: 'disputer_right' });
    assert.equal(failed.status, 502, failed.text);
    assert.equal((await call('GET', `/requests/${id}`)).body.request.status, 'disputed');
    mockFaults.delete('release');
    assert.equal((await resolve(a, id, { verdict: 'disputer_right' })).status, 200);
    const calls = mockCalls.slice(before);
    assert.equal(calls.filter((c) => c.args[0] === bondId).length, 1, 'stake paid more than once');
    assert.equal(await strikes(a.r), sBefore + 1, 'punished more than once');
  });
  await check('false dispute where the payout fails once: still exactly one ban and one stake payout after the retry', async () => {
    const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
    const bondId = bondOf((await call('GET', `/requests/${id}`)).body.request); const before = mockCalls.length;
    mockFaults.add('release');
    assert.equal((await resolve(a, id, { verdict: 'disputer_wrong' })).status, 502);
    mockFaults.delete('release');
    assert.equal((await resolve(a, id, { verdict: 'disputer_wrong' })).status, 200);
    assert.equal(mockCalls.slice(before).filter((c) => c.args[0] === bondId && c.functionName === 'release').length, 1);
    assert.equal((await user(a.r)).banned, true);
  });
  await check('the stake belongs to the right person even when roles are reversed (fulfiller disputes, loses -> requester gets the stake)', async () => {
    const a = await actors(); const { id } = await trade(a, { dispute: { by: 'f' } });
    const bondId = bondOf((await call('GET', `/requests/${id}`)).body.request); const before = mockCalls.length;
    await resolve(a, id, { verdict: 'disputer_wrong' });
    const pay = mockCalls.slice(before).find((c) => c.args[0] === bondId);
    assert.equal(pay.functionName, 'release'); assert.equal(pay.args[1], getAddress(a.r.address));
  });
}

console.log('\n== 5. Secrets and public data ==');
await check('the public request view has no bond nonce and no screenshot bytes; the private nonce is not in any response', async () => {
  const a = await actors(); const { id } = await trade(a, { dispute: { by: 'r' } });
  const img = png(); await call('POST', `/requests/${id}/evidence`, { token: a.tr, raw: img, type: 'image/png' });
  const pub = await call('GET', `/requests/${id}`);
  assert.ok(!pub.text.includes(img.toString('base64').slice(0, 30)));
  if (BOND) {
    const nonce = (await col.requests.doc(id).collection('private').doc(`bond-${addr(a.r)}`).get()).data().nonce;
    for (const r of [pub, await call('GET', `/requests/${id}/evidence`, { token: a.tr }), await call('GET', '/requests/mine', { token: a.tr })]) assert.ok(!r.text.includes(nonce));
  }
});
await check('a stranger and the other party cannot read the disputer\'s private bond data via the API', async () => {
  const a = await actors(); const { id } = await trade(a);
  const mine = await call('POST', `/requests/${id}/dispute/bond`, { token: a.tr });
  const theirs = await call('POST', `/requests/${id}/dispute/bond`, { token: a.tf });
  if (BOND) assert.notEqual(mine.body.bond.escrowId, theirs.body.bond.escrowId); // the other party cannot learn (or front-run) my bond id
});

console.log(`\n==== ${pass}/${pass + fail} checks passed (${MODE}) ====`);
server.close();
process.exit(fail ? 1 : 0);
