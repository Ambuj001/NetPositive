// End-to-end smoke test against the Firestore emulator (npm run smoke).
// Uses ESCROW_MODE=mock and WORLD_ID_MOCK=true; exercises auth, World ID binding and every lifecycle path.
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mockResult } from '../test-support/world-mock.mjs';

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'x'.repeat(48),
  VOUCHER_ENC_KEY: 'ab'.repeat(32),
  FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT ?? 'demo-netpositive',
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085',
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_MOCK: 'true',
  RECOVERY_DELAY_MINUTES: '60',
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
  FULFIL_WINDOW_MINUTES: '30',
  REVIEW_WINDOW_MINUTES: '60',
  CRON_SECRET: 'cron-test-secret',
});
const admin = privateKeyToAccount(generatePrivateKey());
process.env.ADMIN_ADDRESSES = admin.address;

const { createApp } = await import('../src/app.js');
const { col, Timestamp } = await import('../src/services/firestore.js');
// Simulate the passage of time by backdating a deadline (keeps the test deterministic).
const expire = (id, field) => col.requests.doc(id).update({ [field]: Timestamp.fromMillis(Date.now() - 1000) });
const server = createApp().listen(0);
const base = `http://127.0.0.1:${server.address().port}`;

async function call(method, path, { token, body, headers = {} } = {}) {
  const res = await fetch(base + path, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
}

async function signIn(account) {
  const { body } = await call('POST', '/auth/nonce', { body: { address: account.address } });
  const signature = await account.signMessage({ message: body.message });
  const r = await call('POST', '/auth/verify', { body: { address: account.address, signature } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.token;
}

const fakeTx = () => `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`;
const step = (name) => console.log(`  ✓ ${name}`);
// World ID v4 in mock mode: ask the server for a request, "prove" with a chosen nullifier (= which human).
async function worldVerify(token, nullifier, tweak) {
  const { body: request } = await call('POST', '/world-id/request', { token });
  const result = mockResult({ request, nullifier });
  if (tweak) tweak(result);
  return call('POST', '/world-id/verify', { token, body: result });
}
async function newTrader(human) {
  const account = privateKeyToAccount(generatePrivateKey());
  const token = await signIn(account);
  if (human != null) assert.equal((await worldVerify(token, human)).status, 200);
  return { account, token };
}
// Funds + accepts + submits a code. Returns the request id (status code_submitted).
async function tradeUpToCode(requester, fulfiller, code = 'SOME-CODE-0001') {
  let r = await call('POST', '/requests', { token: requester.token, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11.25' } });
  const id = r.body.request.id;
  await call('POST', `/requests/${id}/fund`, { token: requester.token, body: { txHash: fakeTx() } });
  await call('POST', `/requests/${id}/accept`, { token: fulfiller.token });
  r = await call('POST', `/requests/${id}/submit-code`, { token: fulfiller.token, body: { code } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return id;
}

try {
  const alice = privateKeyToAccount(generatePrivateKey()); // requester
  const bob = privateKeyToAccount(generatePrivateKey()); // fulfiller
  const mallory = privateKeyToAccount(generatePrivateKey()); // sybil
  const nonce = Date.now();

  const [ta, tb, tm, tadmin] = await Promise.all([signIn(alice), signIn(bob), signIn(mallory), signIn(admin)]);
  step('wallet sign-in');

  // Replay of a consumed nonce must fail
  {
    const { body } = await call('POST', '/auth/nonce', { body: { address: alice.address } });
    const signature = await alice.signMessage({ message: body.message });
    await call('POST', '/auth/verify', { body: { address: alice.address, signature } });
    const replay = await call('POST', '/auth/verify', { body: { address: alice.address, signature } });
    assert.equal(replay.status, 401);
  }
  step('nonce replay rejected');

  let r = await call('POST', '/requests', { token: ta, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11.25' } });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, 'world_id_required');
  step('World ID gate blocks unverified users');

  assert.equal((await worldVerify(ta, nonce)).status, 200);
  assert.equal((await worldVerify(ta, nonce)).status, 200); // idempotent
  assert.equal((await worldVerify(tb, nonce + 1)).status, 200);
  r = await worldVerify(tm, nonce); // reuse Alice's human on another wallet
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'world_id_already_used');
  step('one human ↔ one wallet enforced');

  // ---- World ID v4 checks ----
  {
    const { body: request } = await call('POST', '/world-id/request', { token: tm });
    const good = mockResult({ request, nullifier: nonce + 50 });
    let x = await call('POST', '/world-id/verify', { token: tm, body: { ...good, action: 'some-other-action' } });
    assert.equal(x.body.error, 'world_id_wrong_context'); // wrong action (checked before the request is used up)
    x = await call('POST', '/world-id/verify', { token: tm, body: good });
    assert.equal(x.status, 200, JSON.stringify(x.body));
    x = await call('POST', '/world-id/verify', { token: tm, body: good }); // replay of the same result
    assert.equal(x.body.error, 'world_request_missing');
    // A proof made for a different wallet is refused
    const { body: other } = await call('POST', '/world-id/request', { token: ta });
    const foreign = mockResult({ request: { ...other, signal: bob.address }, nullifier: nonce });
    x = await call('POST', '/world-id/verify', { token: ta, body: foreign });
    assert.equal(x.body.error, 'world_id_wrong_wallet');
    x = await call('POST', '/world-id/verify', { token: ta, body: { nonsense: true } });
    assert.equal(x.status, 400);
  }
  step('World ID v4: wrong action, replay, wrong wallet and malformed results refused');

  // ---- Happy path ----
  r = await call('POST', '/requests', { token: ta, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11.25' } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const id = r.body.request.id;
  assert.equal(r.body.request.status, 'pending_funding');
  assert.equal(r.body.request.amountUsdcBaseUnits, '11250000');
  assert.match(r.body.request.escrowId, /^0x[0-9a-f]{64}$/);

  assert.equal((await call('POST', `/requests/${id}/accept`, { token: tb })).status, 409); // not funded yet
  r = await call('POST', `/requests/${id}/fund`, { token: ta, body: { txHash: fakeTx() } });
  assert.equal(r.body.request.status, 'open');
  r = await call('GET', '/requests?brand=amazon');
  assert.ok(r.body.requests.some((x) => x.id === id));
  step('create → fund → listed as open');

  assert.equal((await call('POST', `/requests/${id}/accept`, { token: ta })).status, 403); // self-accept
  const [a1, a2] = await Promise.all([
    call('POST', `/requests/${id}/accept`, { token: tb }),
    call('POST', `/requests/${id}/accept`, { token: tb }),
  ]);
  assert.deepEqual([a1.status, a2.status].sort(), [200, 409]);
  step('accept is race-safe and self-accept blocked');

  assert.equal((await call('GET', `/requests/${id}/voucher`, { token: ta })).status, 409); // nothing yet
  r = await call('POST', `/requests/${id}/submit-code`, { token: tb, body: { code: 'AMZN-1234-5678', pin: '4321' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.request.status, 'code_submitted');
  assert.equal((await call('GET', `/requests/${id}/voucher`, { token: tb })).status, 403); // fulfiller can't read back
  r = await call('GET', `/requests/${id}/voucher`, { token: ta });
  assert.equal(r.body.voucher.code, 'AMZN-1234-5678');
  assert.equal(r.body.voucher.pin, '4321');
  step('code stored encrypted, only requester can read');

  const [c1, c2] = await Promise.all([
    call('POST', `/requests/${id}/confirm`, { token: ta }),
    call('POST', `/requests/${id}/confirm`, { token: ta }),
  ]);
  assert.deepEqual([c1.status, c2.status].sort(), [200, 409]);
  r = await call('GET', `/requests/${id}`);
  assert.equal(r.body.request.status, 'released');
  assert.ok(r.body.request.releaseTxHash);
  step('confirm → released exactly once');

  r = await call('GET', '/auth/me', { token: tb });
  assert.equal(r.body.user.reputation.completed, 1);
  step('reputation updated');

  // ---- Cancel paths ----
  r = await call('POST', '/requests', { token: ta, body: { brand: 'swiggy', amountInr: 500, amountUsdc: '5.6' } });
  const unfunded = r.body.request.id;
  assert.equal((await call('POST', `/requests/${unfunded}/cancel`, { token: ta })).body.request.status, 'cancelled');
  r = await call('POST', '/requests', { token: ta, body: { brand: 'swiggy', amountInr: 500, amountUsdc: '5.6' } });
  const funded = r.body.request.id;
  await call('POST', `/requests/${funded}/fund`, { token: ta, body: { txHash: fakeTx() } });
  assert.equal((await call('POST', `/requests/${funded}/cancel`, { token: tb })).status, 403);
  assert.equal((await call('POST', `/requests/${funded}/cancel`, { token: ta })).body.request.status, 'refunded');
  step('cancel unfunded → cancelled, cancel funded → refunded');

  // ---- Dispute + admin resolve ----
  r = await call('POST', '/requests', { token: ta, body: { brand: 'flipkart', amountInr: 2000, amountUsdc: '22.5' } });
  const disputed = r.body.request.id;
  await call('POST', `/requests/${disputed}/fund`, { token: ta, body: { txHash: fakeTx() } });
  await call('POST', `/requests/${disputed}/accept`, { token: tb });
  await call('POST', `/requests/${disputed}/submit-code`, { token: tb, body: { code: 'FLIP-ALREADY-USED' } });
  r = await call('POST', `/requests/${disputed}/dispute`, { token: ta, body: { reason: 'Code says already redeemed' } });
  assert.equal(r.body.request.status, 'disputed');
  assert.equal((await call('POST', `/requests/${disputed}/resolve`, { token: ta, body: { outcome: 'refund' } })).status, 403);
  assert.equal((await call('GET', `/requests/${disputed}/voucher`, { token: tadmin })).status, 200); // admin can inspect
  r = await call('POST', `/requests/${disputed}/resolve`, { token: tadmin, body: { outcome: 'refund', note: 'verified redeemed', fault: 'none' } });
  assert.equal(r.body.request.status, 'refunded');
  step('dispute → admin refund (fault: none bans nobody)');

  // ---- Timeouts via sweeper ----
  r = await call('POST', '/requests', { token: ta, body: { brand: 'zomato', amountInr: 300, amountUsdc: '3.4' } });
  const ghosted = r.body.request.id;
  await call('POST', `/requests/${ghosted}/fund`, { token: ta, body: { txHash: fakeTx() } });
  await call('POST', `/requests/${ghosted}/accept`, { token: tb });

  r = await call('POST', '/requests', { token: ta, body: { brand: 'myntra', amountInr: 800, amountUsdc: '9' } });
  const silent = r.body.request.id;
  await call('POST', `/requests/${silent}/fund`, { token: ta, body: { txHash: fakeTx() } });
  await call('POST', `/requests/${silent}/accept`, { token: tb });
  await call('POST', `/requests/${silent}/submit-code`, { token: tb, body: { code: 'MYNTRA-OK-0001' } });

  await Promise.all([expire(ghosted, 'fulfilDeadline'), expire(silent, 'reviewDeadline')]);
  assert.equal((await call('POST', `/requests/${silent}/dispute`, { token: ta, body: { reason: 'too late to dispute' } })).status, 409);
  assert.equal((await call('POST', `/requests/${ghosted}/submit-code`, { token: tb, body: { code: 'LATE-CODE' } })).status, 409);
  assert.equal((await call('POST', '/internal/sweep', { headers: { 'x-cron-secret': 'wrong-secret-0000' } })).status, 401);
  r = await call('POST', '/internal/sweep', { headers: { 'x-cron-secret': 'cron-test-secret' } });
  assert.ok(r.body.reopened >= 1 && r.body.autoReleased >= 1, JSON.stringify(r.body));
  r = await call('GET', `/requests/${ghosted}`);
  assert.equal(r.body.request.status, 'open');
  assert.equal(r.body.request.fulfiller, null);
  assert.equal((await call('GET', `/requests/${silent}`)).body.request.status, 'released');
  assert.equal((await call('GET', '/auth/me', { token: tb })).body.user.reputation.strikes, 1);
  step('sweeper: expired accept reopened + strike, expired review auto-released');

  // ---- Fraud ban: the HUMAN is banned, not just the wallet ----
  {
    const carol = await newTrader(nonce + 100); // requester
    const dave = await newTrader(nonce + 101); // fulfiller who hands over a used voucher
    const id1 = await tradeUpToCode(carol, dave, 'ALREADY-USED-123');
    await call('POST', `/requests/${id1}/dispute`, { token: carol.token, body: { reason: 'Voucher already redeemed' } });
    r = await call('POST', `/requests/${id1}/resolve`, { token: tadmin, body: { outcome: 'refund' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.request.resolution.fault, 'fulfiller');
    assert.equal(r.body.request.status, 'refunded');
    assert.equal((await call('GET', '/auth/me', { token: dave.token })).status, 403); // banned wallet is locked out
    // Dave comes back with a NEW wallet and the same World ID → refused
    const dave2 = await newTrader();
    r = await worldVerify(dave2.token, nonce + 101);
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'human_banned');
    // ...and cannot recover into a new wallet either
    const { body: rq } = await call('POST', '/world-id/request', { token: dave2.token });
    r = await call('POST', '/recovery/start', { token: dave2.token, body: mockResult({ request: rq, nullifier: nonce + 101 }) });
    assert.equal(r.body.error, 'human_banned');
    // Carol (honest) is untouched
    assert.equal((await call('GET', '/auth/me', { token: carol.token })).status, 200);
    step('fulfiller who sold a used voucher is banned as a human (new wallet + recovery refused)');

    // Requester lies: the voucher was fine, the dispute is resolved for the fulfiller → requester banned
    const erin = await newTrader(nonce + 102); // requester (liar)
    const frank = await newTrader(nonce + 103); // honest fulfiller
    const id2 = await tradeUpToCode(erin, frank, 'PERFECTLY-GOOD-1');
    await call('POST', `/requests/${id2}/dispute`, { token: erin.token, body: { reason: 'Says it is used (it is not)' } });
    r = await call('POST', `/requests/${id2}/resolve`, { token: tadmin, body: { outcome: 'release' } });
    assert.equal(r.body.request.resolution.fault, 'requester');
    assert.equal(r.body.request.status, 'released');
    assert.equal((await call('GET', '/auth/me', { token: erin.token })).status, 403);
    assert.equal((await call('GET', '/auth/me', { token: frank.token })).status, 200);
    assert.equal((await worldVerify((await newTrader()).token, nonce + 102)).body.error, 'human_banned');
    step('requester who falsely claimed a used voucher is banned as a human');
  }

  // ---- Lose your wallet, not your money ----
  {
    const buyer = await newTrader(nonce + 200); // requester with USDC in escrow
    const helper = await newTrader(nonce + 201); // some fulfiller
    // (a) an open, funded request that nobody has accepted
    r = await call('POST', '/requests', { token: buyer.token, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11.25' } });
    const openId = r.body.request.id;
    await call('POST', `/requests/${openId}/fund`, { token: buyer.token, body: { txHash: fakeTx() } });
    // (b) a request where `buyer` is the fulfiller and has already accepted someone else's order
    const seller = await newTrader(nonce + 202);
    r = await call('POST', '/requests', { token: seller.token, body: { brand: 'swiggy', amountInr: 500, amountUsdc: '5.6' } });
    const fulfilId = r.body.request.id;
    await call('POST', `/requests/${fulfilId}/fund`, { token: seller.token, body: { txHash: fakeTx() } });
    await call('POST', `/requests/${fulfilId}/accept`, { token: buyer.token });
    // (c) buyer completed one trade earlier (as fulfiller), so there is reputation to carry over
    const repId = await tradeUpToCode(helper, buyer, 'REP-CODE-0001');
    await call('POST', `/requests/${repId}/confirm`, { token: helper.token });

    // The wallet is lost. A brand-new wallet signs in and proves it is the same human.
    const fresh = await newTrader();
    r = await worldVerify(fresh.token, nonce + 200);
    assert.equal(r.body.error, 'world_id_already_used'); // normal sign-up refuses a second wallet...
    const startRecovery = async (who, human) => {
      const { body: rq } = await call('POST', '/world-id/request', { token: who.token });
      return call('POST', '/recovery/start', { token: who.token, body: mockResult({ request: rq, nullifier: human }) });
    };
    // A different human cannot recover this account
    const stranger = await newTrader();
    r = await startRecovery(stranger, nonce + 999);
    assert.equal(r.body.error, 'no_account_to_recover');
    // The same human can
    r = await startRecovery(fresh, nonce + 200);
    assert.equal(r.status, 201, JSON.stringify(r.body));
    const recId = r.body.recovery.id;
    assert.equal(r.body.recovery.oldAddress, buyer.account.address.toLowerCase());
    assert.equal(r.body.recovery.status, 'pending');
    assert.equal((await startRecovery(fresh, nonce + 200)).body.error, 'recovery_pending'); // not twice
    // Too early
    r = await call('POST', `/recovery/${recId}/complete`, { token: fresh.token });
    assert.equal(r.body.error, 'recovery_too_early');
    // Only the new wallet completes; only the old wallet cancels
    assert.equal((await call('POST', `/recovery/${recId}/complete`, { token: stranger.token })).status, 403);
    assert.equal((await call('POST', `/recovery/${recId}/cancel`, { token: fresh.token })).status, 403);

    // The old wallet is still in the owner's hands → it can veto
    r = await call('POST', `/recovery/${recId}/cancel`, { token: buyer.token });
    assert.equal(r.body.recovery.status, 'cancelled');
    r = await startRecovery(fresh, nonce + 200); // start again; this time the wallet really is lost
    const recId2 = r.body.recovery.id;
    await col.recoveries.doc(recId2).update({ executeAfter: Timestamp.fromMillis(Date.now() - 1000) }); // fast-forward the wait
    r = await call('POST', `/recovery/${recId2}/complete`, { token: fresh.token });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.recovery.status, 'completed');

    // The new wallet now IS the human; the old wallet is not
    r = await call('GET', '/auth/me', { token: fresh.token });
    assert.equal(r.body.user.reputation.completed, 1);
    assert.ok(r.body.user.worldIdNullifier);
    r = await call('POST', '/requests', { token: buyer.token, body: { brand: 'amazon', amountInr: 100, amountUsdc: '1.2' } });
    assert.equal(r.body.error, 'world_id_required'); // old wallet lost its human status
    // The escrowed request is the new wallet's: cancelling refunds to the NEW wallet
    assert.equal((await call('POST', `/requests/${openId}/cancel`, { token: buyer.token })).status, 403);
    r = await call('POST', `/requests/${openId}/cancel`, { token: fresh.token });
    assert.equal(r.body.request.status, 'refunded');
    assert.equal(r.body.request.refundTo, fresh.account.address.toLowerCase());
    // The order it had accepted as fulfiller is now the new wallet's to finish
    r = await call('POST', `/requests/${fulfilId}/submit-code`, { token: fresh.token, body: { code: 'RECOVERED-CODE-1' } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.request.fulfiller, fresh.account.address.toLowerCase());
    assert.equal((await call('POST', `/requests/${fulfilId}/submit-code`, { token: buyer.token, body: { code: 'OLD-WALLET-CODE' } })).status, 403);
    step('lose your wallet, not your money: same human, new wallet takes over account, escrow and trades');
  }

  r = await call('GET', '/requests/mine', { token: tb });
  assert.ok(r.body.asFulfiller.length >= 3);
  r = await call('POST', '/requests', { token: ta, body: { brand: 'nope', amountInr: -1, amountUsdc: '1.1234567' } });
  assert.equal(r.status, 400);
  assert.equal(r.body.details.length, 3);
  step('listing + validation');

  console.log('\nAll smoke checks passed.');
} catch (err) {
  console.error('\nSMOKE TEST FAILED:', err);
  process.exitCode = 1;
} finally {
  server.close();
  setTimeout(() => process.exit(), 200);
}
