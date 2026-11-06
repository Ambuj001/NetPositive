// End-to-end smoke test against the Firestore emulator (npm run smoke).
// Uses ESCROW_MODE=mock and WORLD_ID_MOCK=true; exercises auth, World ID binding and every lifecycle path.
import assert from 'node:assert/strict';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET: 'x'.repeat(48),
  VOUCHER_ENC_KEY: 'ab'.repeat(32),
  FIREBASE_PROJECT_ID: process.env.GCLOUD_PROJECT ?? 'demo-netpositive',
  FIRESTORE_EMULATOR_HOST: process.env.FIRESTORE_EMULATOR_HOST ?? '127.0.0.1:8085',
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_RP_ID: 'rp_test',
  WORLD_ID_SIGNING_KEY: 'ab'.repeat(32),
  WORLD_ID_ENV: 'staging',
  WORLD_ID_MOCK: 'true',
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
  FULFIL_WINDOW_MINUTES: '30',
  REVIEW_WINDOW_MINUTES: '60',
  CRON_SECRET: 'cron-test-secret',
});
const admin = privateKeyToAccount(generatePrivateKey());
process.env.ADMIN_ADDRESSES = admin.address;

const { createApp } = await import('../src/app.js');
const { hashSignal } = await import('@worldcoin/idkit-core/hashing');
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

const fakeProof = (n, address) => ({
  rp_id: 'rp_test',
  idkitResponse: {
    protocol_version: '4.0',
    nonce: `nonce-${n}`,
    action: 'netpositive-account',
    environment: 'staging',
    responses: [
      {
        identifier: 'proof_of_human',
        signal_hash: hashSignal(address.toLowerCase()),
        nullifier: `0x${n.toString(16).padStart(64, '0')}`,
        proof: ['1', '2', '3', '4', '5'],
        issuer_schema_id: 1,
        expires_at_min: 1,
      },
    ],
  },
});
const fakeTx = () => `0x${Math.random().toString(16).slice(2).padEnd(64, '0')}`;
const step = (name) => console.log(`  ✓ ${name}`);

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

  r = await call('POST', '/world-id/rp-signature', { token: ta, body: { action: 'netpositive-account' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.rp_id, 'rp_test');
  assert.ok(r.body.sig && r.body.nonce);
  step('RP signature');

  const forged = fakeProof(nonce + 8, alice.address);
  r = await call('POST', '/world-id/verify', { token: tm, body: forged });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'world_id_signal');

  const selfie = fakeProof(nonce + 9, alice.address);
  selfie.idkitResponse.responses[0].identifier = 'selfie';
  r = await call('POST', '/world-id/verify', { token: ta, body: selfie });
  assert.equal(r.status, 400);
  assert.equal(r.body.error, 'world_id_credential');

  assert.equal((await call('POST', '/world-id/verify', { token: ta, body: fakeProof(nonce, alice.address) })).status, 200);
  assert.equal((await call('POST', '/world-id/verify', { token: ta, body: fakeProof(nonce, alice.address) })).status, 200); // idempotent
  assert.equal((await call('POST', '/world-id/verify', { token: tb, body: fakeProof(nonce + 1, bob.address) })).status, 200);
  r = await call('POST', '/world-id/verify', { token: tm, body: fakeProof(nonce, mallory.address) }); // reuse Alice's human
  assert.equal(r.status, 409);
  assert.equal(r.body.error, 'world_id_already_used');
  // the person who just proved they ARE this human is told which wallet holds the link, and which wallet they are on
  assert.equal(r.body.details.linkedWallet, alice.address.toLowerCase());
  assert.equal(r.body.details.yourWallet, mallory.address.toLowerCase());
  assert.notEqual(r.body.details.linkedWallet, r.body.details.yourWallet);
  // the same human on the SAME wallet is never refused, whatever letter case the address is written in
  assert.equal((await call('POST', '/world-id/verify', { token: ta, body: fakeProof(nonce, alice.address) })).status, 200);
  {
    const stored = await col.nullifiers.doc(`0x${nonce.toString(16).padStart(64, '0')}`).get();
    await stored.ref.update({ address: alice.address.toUpperCase().replace('0X', '0x') }); // a record written with different letter case
    assert.equal((await call('POST', '/world-id/verify', { token: ta, body: fakeProof(nonce, alice.address) })).status, 200, 'case difference must not cause a false "already linked"');
    await stored.ref.update({ address: alice.address.toLowerCase() });
  }
  step('one human ↔ one wallet enforced; the error names the linked wallet; address case never causes a false refusal');

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

  // ---- Ready permit: the spender tells the accepted buyer "I am ready" (gasless EIP-712 signature) ----
  const READY = {
    domain: { name: 'NetPositiveCodeMailbox', version: '1', chainId: 5042002, verifyingContract: '0xA8243e92A89de7F62D3023EB68EEB4f4e40e88B1' },
    types: { Ready: [{ name: 'escrowId', type: 'bytes32' }, { name: 'fulfiller', type: 'address' }, { name: 'validUntil', type: 'uint64' }] },
  };
  const signReady = (acct, message, domain = READY.domain) => acct.signTypedData({ domain, types: READY.types, primaryType: 'Ready', message });
  {
    const orderDoc = (await call('GET', `/requests/${id}`)).body.request;
    const now = Math.floor(Date.now() / 1000);
    const msg = (over = {}) => ({ escrowId: orderDoc.escrowId, fulfiller: orderDoc.crypto_buyer, validUntil: BigInt(now + 600), ...over });
    const post = (token, validUntil, signature) => call('POST', `/requests/${id}/ready`, { token, body: { validUntil, signature } });

    // the server hands the wallet the exact typed data (single source of truth for the contract's domain)
    r = await call('GET', `/requests/${id}/ready-permit`, { token: ta });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.typedData.primaryType, 'Ready');
    assert.equal(r.body.typedData.domain.name, 'NetPositiveCodeMailbox');
    assert.equal(r.body.typedData.message.fulfiller, orderDoc.crypto_buyer);
    assert.equal(r.body.typedData.message.escrowId, orderDoc.escrowId);
    assert.ok(r.body.typedData.types.EIP712Domain, 'wallets need EIP712Domain in the types');
    assert.equal((await call('GET', `/requests/${id}/ready-permit`, { token: tb })).status, 403); // buyer cannot ask for the permit

    // refusals
    assert.equal((await post(tb, now + 600, await signReady(alice, msg()))).status, 403); // only the spender may post it
    r = await post(ta, now + 600, await signReady(bob, msg())); // signed by the wrong wallet
    assert.equal(r.body.error, 'bad_ready_signature');
    r = await post(ta, now + 600, await signReady(alice, msg({ fulfiller: mallory.address }))); // names another buyer
    assert.equal(r.body.error, 'bad_ready_signature');
    r = await post(ta, now + 600, await signReady(alice, msg({ escrowId: '0x' + '11'.repeat(32) }))); // another order
    assert.equal(r.body.error, 'bad_ready_signature');
    r = await post(ta, now + 600, await signReady(alice, msg(), { ...READY.domain, chainId: 1 })); // another chain
    assert.equal(r.body.error, 'bad_ready_signature');
    r = await post(ta, now + 601, await signReady(alice, msg())); // signed validUntil differs from the one sent
    assert.equal(r.body.error, 'bad_ready_signature');
    r = await post(ta, now - 5, await signReady(alice, msg({ validUntil: BigInt(now - 5) })));
    assert.equal(r.body.error, 'ready_expired');
    r = await post(ta, now + 7200, await signReady(alice, msg({ validUntil: BigInt(now + 7200) })));
    assert.equal(r.body.error, 'ready_too_long');
    assert.equal((await post(ta, now + 600, 'not-a-signature')).status, 400);
    assert.equal((await call('GET', `/requests/${id}`)).body.request.ready ?? null, null); // nothing was stored

    // success: stored on the public request so the buyer can see it
    r = await post(ta, now + 600, await signReady(alice, msg()));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal(r.body.request.ready.validUntil, now + 600);
    assert.match(r.body.request.ready.signature, /^0x[0-9a-f]{130}$/i);
    assert.ok(r.body.request.ready.signedAt);
    assert.equal((await call('GET', `/requests/${id}`)).body.request.ready.validUntil, now + 600);
    // signing again replaces it
    r = await post(ta, now + 900, await signReady(alice, msg({ validUntil: BigInt(now + 900) })));
    assert.equal(r.body.request.ready.validUntil, now + 900);
    // it does not gate the buyer: submit-code below still works
  }
  step('Ready permit: only the spender, only the right buyer/order/chain/expiry; stored publicly');

  {
    // not allowed before a buyer has accepted
    const o = (await call('POST', '/requests', { token: ta, body: { brand: 'amazon', amountInr: 500, amountUsdc: '5.6' } })).body.request.id;
    await call('POST', `/requests/${o}/fund`, { token: ta, body: { txHash: fakeTx() } });
    assert.equal((await call('GET', `/requests/${o}/ready-permit`, { token: ta })).body.error, 'invalid_status');
    r = await call('POST', `/requests/${o}/ready`, { token: ta, body: { validUntil: Math.floor(Date.now() / 1000) + 300, signature: '0x' + 'ab'.repeat(65) } });
    assert.equal(r.body.error, 'invalid_status');
    await call('POST', `/requests/${o}/cancel`, { token: ta });
  }
  step('Ready permit refused while the order is not accepted');

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
  r = await call('POST', `/requests/${disputed}/resolve`, { token: tadmin, body: { outcome: 'refund', note: 'verified redeemed' } });
  assert.equal(r.body.request.status, 'refunded');
  step('dispute → admin refund');

  // ---- Timeouts via sweeper ----
  r = await call('POST', '/requests', { token: ta, body: { brand: 'zomato', amountInr: 300, amountUsdc: '3.4' } });
  const ghosted = r.body.request.id;
  await call('POST', `/requests/${ghosted}/fund`, { token: ta, body: { txHash: fakeTx() } });
  await call('POST', `/requests/${ghosted}/accept`, { token: tb });
  {
    const g = (await call('GET', `/requests/${ghosted}`)).body.request;
    const vu = Math.floor(Date.now() / 1000) + 600;
    r = await call('POST', `/requests/${ghosted}/ready`, { token: ta, body: { validUntil: vu, signature: await signReady(alice, { escrowId: g.escrowId, fulfiller: g.crypto_buyer, validUntil: BigInt(vu) }) } });
    assert.equal(r.status, 200, JSON.stringify(r.body));
  }

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
  assert.equal(r.body.request.crypto_buyer, null);
  assert.equal(r.body.request.ready, null); // the old buyer's permit is dropped when the order reopens
  assert.equal((await call('GET', `/requests/${silent}`)).body.request.status, 'released');
  assert.equal((await call('GET', '/auth/me', { token: tb })).body.user.reputation.strikes, 1);
  step('sweeper: expired accept reopened + strike, expired review auto-released');

  r = await call('GET', '/requests/mine', { token: tb });
  assert.ok(r.body.asCryptoBuyer.length >= 3);
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
