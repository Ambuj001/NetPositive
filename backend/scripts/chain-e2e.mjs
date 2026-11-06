// End-to-end test of the Express backend against the DEPLOYED escrow on Arc testnet (contract "A", contracts/src/VoucherEscrow.sol).
// Database: always the in-memory stand-in (nothing is written to Firestore). Chain: REAL, only when explicitly confirmed.
//
// DRY RUN (default; escrow is mocked, no chain access, validates this script and the backend flow):
//   node --import ./test-support/register.mjs scripts/chain-e2e.mjs
// REAL TESTNET RUN (sends real transactions; spends ~0.5 testnet USDC + gas, most of it returned):
//   OPERATOR_PK=<key of the contract operator> [DEPOSITOR_PK=<funded wallet; defaults to the operator>] \
//   ESCROW_CONTRACT_ADDRESS=0x... CONFIRM_CHAIN_TX=<same contract address> \
//   node --import ./test-support/register.mjs scripts/chain-e2e.mjs
//
// SAFETY: keys are read only from the environment, never printed or written. A real run needs CONFIRM_CHAIN_TX to equal the contract
// address, and refuses unless the key really is the contract's operator and the chain is Arc testnet (5042002).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { createPublicClient, createWalletClient, defineChain, formatUnits, getAddress, http, parseAbi } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mockResult, WORLD_ID_TEST_ENV } from '../test-support/world-v4-mock.mjs';

const REAL = Boolean(process.env.CONFIRM_CHAIN_TX);
const RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io';
const CHAIN_ID = 5042002;
const USDC = '0x3600000000000000000000000000000000000000';
const AMOUNT_INR = 9; // at 90 INR/USDC = 0.10 USDC
const AMOUNT_USDC = '0.10';
const AMOUNT_BASE = 100000n;

let operatorKey, depositor, contract;
if (REAL) {
  contract = process.env.ESCROW_CONTRACT_ADDRESS;
  if (!contract || process.env.CONFIRM_CHAIN_TX.toLowerCase() !== contract.toLowerCase()) {
    console.error('Refusing a REAL run: set ESCROW_CONTRACT_ADDRESS and CONFIRM_CHAIN_TX to the same contract address.'); process.exit(2);
  }
  if (!process.env.OPERATOR_PK) { console.error('OPERATOR_PK is required for a real run.'); process.exit(2); }
  operatorKey = '0x' + process.env.OPERATOR_PK.replace(/^0x/, '');
  depositor = privateKeyToAccount('0x' + (process.env.DEPOSITOR_PK || process.env.OPERATOR_PK).replace(/^0x/, ''));
}
Object.assign(process.env, {
  NODE_ENV: 'development',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  ...WORLD_ID_TEST_ENV,
  SWEEP_INTERVAL_SECONDS: '0',
  DISPUTE_BOND_USDC: '0.05', // dispute stake used in section 3b
  CORS_ORIGINS: 'http://localhost:3000',
  ARC_RPC_URL: RPC,
  ARC_CHAIN_ID: String(CHAIN_ID),
  ESCROW_MODE: REAL ? 'chain' : 'mock',
  ...(REAL && { ESCROW_CONTRACT_ADDRESS: contract, ESCROW_OPERATOR_PRIVATE_KEY: operatorKey }),
});

const adminAcct = privateKeyToAccount(generatePrivateKey());
process.env.ADMIN_ADDRESSES = adminAcct.address;
const { createApp } = await import('../src/app.js');
const { escrowIdFor, ESCROW_ABI } = await import('../src/services/escrow.js');

const chain = defineChain({ id: CHAIN_ID, name: 'Arc', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC, { timeout: 30000 }) });
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)', 'function transfer(address,uint256) returns (bool)']);
const ownerAbi = parseAbi(['function operator() view returns (address)', 'function feeBps() view returns (uint256)']);
const bal = (a) => pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [a] });
const wallet = (acct) => createWalletClient({ account: acct, chain, transport: http(RPC) });
async function tx(acct, params) {
  const hash = await wallet(acct).writeContract(params);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 90_000 });
  assert.equal(r.status, 'success', `tx reverted ${hash}`);
  return hash;
}
const fakeTx = () => `0x${crypto.randomBytes(32).toString('hex')}`;

const results = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (e) { const m = String(e.shortMessage || e.message).replace(/\s+/g, ' ').slice(0, 400); results.push({ name, ok: false }); console.log(`  FAIL  ${name}\n        ${m}`); }
}
const backend = createApp().listen(0);
const BASE = `http://127.0.0.1:${backend.address().port}`;
async function api(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: res.status, body: json, text };
}
async function signIn(acct) {
  const n = await api('POST', '/auth/nonce', { body: { address: acct.address } });
  const v = await api('POST', '/auth/verify', { body: { address: acct.address, signature: await acct.signMessage({ message: n.body.message }) } });
  assert.equal(v.status, 200, v.text);
  const token = v.body.token;
  const w = await api('POST', '/world-id/verify', { token, body: mockResult({ address: acct.address, nullifier: BigInt(`0x${crypto.randomBytes(16).toString('hex')}`) }) });
  assert.equal(w.status, 200, w.text);
  return token;
}

const requester = REAL ? depositor : privateKeyToAccount(generatePrivateKey());
const fulfiller = privateKeyToAccount(generatePrivateKey()); // throwaway; receives the payout
const operatorAcct = REAL ? privateKeyToAccount(operatorKey) : null;
let tReq, tFul, reqA, reqB;
try {
  console.log(`\nMode: ${REAL ? 'REAL ARC TESTNET (transactions are sent)' : 'DRY RUN (mock escrow, no chain)'}   Database: in-memory\n`);

  if (REAL) {
    console.log('== 0. Preconditions (read-only) ==');
    await check('chain is Arc testnet (5042002)', async () => assert.equal(await pub.getChainId(), CHAIN_ID));
    await check('contract has code and its operator is the key we hold', async () => {
      assert.ok((await pub.getCode({ address: contract }))?.length > 2, 'no code at address');
      assert.equal((await pub.readContract({ address: contract, abi: ownerAbi, functionName: 'operator' })).toLowerCase(), operatorAcct.address.toLowerCase());
    });
    await check(`depositor holds enough USDC (needs >= 0.55, has ${formatUnits(await bal(requester.address), 6)})`, async () => assert.ok((await bal(requester.address)) >= 4n * AMOUNT_BASE + 150000n));
    console.log(`  info  contract feeBps = ${await pub.readContract({ address: contract, abi: ownerAbi, functionName: 'feeBps' })} (payout expected = amount minus fee)`);
  }

  console.log('\n== 1. Sign-in ==');
  await check('requester and fulfiller sign in (World ID mocked)', async () => { tReq = await signIn(requester); tFul = await signIn(fulfiller); });

  console.log('\n== 2. Request A: deposit -> fund -> accept -> code -> confirm -> release ==');
  let fulfillerBefore = 0n;
  await check('POST /requests -> pending_funding', async () => {
    const r = await api('POST', '/requests', { token: tReq, body: { brand: 'amazon', amountInr: AMOUNT_INR, amountUsdc: AMOUNT_USDC } });
    assert.equal(r.status, 201, r.text); reqA = r.body.request; assert.equal(reqA.status, 'pending_funding'); assert.equal(reqA.amountUsdcBaseUnits, String(AMOUNT_BASE));
  });
  let depositTx;
  await check(REAL ? 'on-chain: approve + deposit(escrowId, 0.10 USDC) from the requester' : 'simulated deposit', async () => {
    if (!REAL) { depositTx = fakeTx(); return; }
    await tx(requester, { address: USDC, abi: erc20, functionName: 'approve', args: [contract, AMOUNT_BASE] });
    depositTx = await tx(requester, { address: contract, abi: ESCROW_ABI, functionName: 'deposit', args: [escrowIdFor(reqA.id), AMOUNT_BASE] });
  });
  if (REAL) await check('negative: funding with a tx that is NOT a deposit to the escrow is rejected', async () => {
    const approveHash = await tx(requester, { address: USDC, abi: erc20, functionName: 'approve', args: [contract, 0n] });
    const r = await api('POST', `/requests/${reqA.id}/fund`, { token: tReq, body: { txHash: approveHash } });
    assert.equal(r.status, 400, r.text); assert.equal(r.body.error, 'tx_wrong_contract');
  });
  await check('POST /requests/:id/fund verifies the deposit -> open', async () => {
    const r = await api('POST', `/requests/${reqA.id}/fund`, { token: tReq, body: { txHash: depositTx } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'open');
  });
  await check('fulfiller accepts and submits a (fake) voucher code', async () => {
    const a = await api('POST', `/requests/${reqA.id}/accept`, { token: tFul }); assert.equal(a.status, 200, a.text);
    const s = await api('POST', `/requests/${reqA.id}/submit-code`, { token: tFul, body: { code: 'TEST-CODE-0001', pin: '1234' } });
    assert.equal(s.status, 200, s.text); assert.equal(s.body.request.status, 'code_submitted');
  });
  await check('requester reads the voucher, then confirms -> released', async () => {
    const v = await api('GET', `/requests/${reqA.id}/voucher`, { token: tReq }); assert.equal(v.status, 200, v.text);
    assert.equal(v.body.voucher.code, 'TEST-CODE-0001');
    if (REAL) fulfillerBefore = await bal(fulfiller.address);
    const c = await api('POST', `/requests/${reqA.id}/confirm`, { token: tReq }); assert.equal(c.status, 200, c.text);
    assert.equal(c.body.request.status, 'released');
  });
  if (REAL) await check('on-chain: escrow status is Released and the fulfiller received the payout (amount minus fee)', async () => {
    const [, , status] = await pub.readContract({ address: contract, abi: ESCROW_ABI, functionName: 'escrows', args: [escrowIdFor(reqA.id)] });
    assert.equal(status, 2);
    const fee = (AMOUNT_BASE * (await pub.readContract({ address: contract, abi: ownerAbi, functionName: 'feeBps' }))) / 10000n;
    assert.equal((await bal(fulfiller.address)) - fulfillerBefore, AMOUNT_BASE - fee);
  });

  console.log('\n== 3. Request B: deposit -> fund -> cancel -> refund ==');
  await check('POST /requests, deposit, fund -> open', async () => {
    const r = await api('POST', '/requests', { token: tReq, body: { brand: 'swiggy', amountInr: AMOUNT_INR, amountUsdc: AMOUNT_USDC } });
    assert.equal(r.status, 201, r.text); reqB = r.body.request;
    let h = fakeTx();
    if (REAL) {
      await tx(requester, { address: USDC, abi: erc20, functionName: 'approve', args: [contract, AMOUNT_BASE] });
      h = await tx(requester, { address: contract, abi: ESCROW_ABI, functionName: 'deposit', args: [escrowIdFor(reqB.id), AMOUNT_BASE] });
    }
    const f = await api('POST', `/requests/${reqB.id}/fund`, { token: tReq, body: { txHash: h } });
    assert.equal(f.status, 200, f.text); assert.equal(f.body.request.status, 'open');
  });
  await check('cancel an unaccepted funded request -> refunded on-chain', async () => {
    const before = REAL ? await bal(requester.address) : 0n;
    const c = await api('POST', `/requests/${reqB.id}/cancel`, { token: tReq }); assert.equal(c.status, 200, c.text);
    assert.match(c.body.request.status, /refunded|cancelled/);
    if (REAL) {
      const [, , status] = await pub.readContract({ address: contract, abi: ESCROW_ABI, functionName: 'escrows', args: [escrowIdFor(reqB.id)] });
      assert.equal(status, 3);
      assert.ok((await bal(requester.address)) - before >= AMOUNT_BASE - 50000n); // refunded minus nothing (gas is paid by the operator)
    }
  });

  console.log('\n== 3b. Disputes with a REAL stake (0.05 USDC) held in the same escrow contract ==');
  const BOND_BASE = 50000n;
  const statusOf = async (id) => (await pub.readContract({ address: contract, abi: ESCROW_ABI, functionName: 'escrows', args: [id] }))[2];
  let tAdmin;
  await check('admin signs in', async () => { const n = await api('POST', '/auth/nonce', { body: { address: adminAcct.address } }); const v = await api('POST', '/auth/verify', { body: { address: adminAcct.address, signature: await adminAcct.signMessage({ message: n.body.message }) } }); assert.equal(v.status, 200, v.text); tAdmin = v.body.token; });
  async function disputedTrade(brand) {
    const r = await api('POST', '/requests', { token: tReq, body: { brand, amountInr: AMOUNT_INR, amountUsdc: AMOUNT_USDC } }); assert.equal(r.status, 201, r.text);
    const id = r.body.request.id; let h = fakeTx();
    if (REAL) { await tx(requester, { address: USDC, abi: erc20, functionName: 'approve', args: [contract, AMOUNT_BASE] }); h = await tx(requester, { address: contract, abi: ESCROW_ABI, functionName: 'deposit', args: [escrowIdFor(id), AMOUNT_BASE] }); }
    assert.equal((await api('POST', `/requests/${id}/fund`, { token: tReq, body: { txHash: h } })).status, 200);
    assert.equal((await api('POST', `/requests/${id}/accept`, { token: tFul })).status, 200);
    assert.equal((await api('POST', `/requests/${id}/submit-code`, { token: tFul, body: { code: 'TEST-CODE-0002', pin: '4321' } })).status, 200);
    const t = await api('POST', `/requests/${id}/dispute/bond`, { token: tReq }); assert.equal(t.status, 200, t.text);
    assert.equal(t.body.bond.amountBaseUnits, String(BOND_BASE));
    return { id, bondId: t.body.bond.escrowId };
  }
  async function stake(bondId) {
    if (!REAL) return fakeTx();
    await tx(requester, { address: USDC, abi: erc20, functionName: 'approve', args: [contract, BOND_BASE] });
    return tx(requester, { address: contract, abi: ESCROW_ABI, functionName: 'deposit', args: [bondId, BOND_BASE] });
  }
  let d1;
  await check('stake is checked on-chain: a tx that is not a deposit to the escrow is refused and the trade stays untouched', async () => {
    d1 = await disputedTrade('flipkart');
    if (!REAL) return;
    const bogus = await tx(requester, { address: USDC, abi: erc20, functionName: 'approve', args: [contract, 0n] });
    const r = await api('POST', `/requests/${d1.id}/dispute`, { token: tReq, body: { category: 'invalid_code', reason: 'the code does not work', bondTxHash: bogus } });
    assert.equal(r.status, 400, r.text);
    assert.equal((await api('GET', `/requests/${d1.id}`)).body.request.status, 'code_submitted');
  });
  await check('requester stakes 0.05 USDC on-chain and raises the dispute with a reason and a screenshot', async () => {
    const h = await stake(d1.bondId);
    const r = await api('POST', `/requests/${d1.id}/dispute`, { token: tReq, body: { category: 'already_redeemed', reason: 'The brand site says this code was already redeemed', bondTxHash: h } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.dispute.bond.status, 'held');
    if (REAL) assert.equal(await statusOf(d1.bondId), 1); // Funded
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), crypto.randomBytes(500)]);
    const up = await fetch(`${BASE}/requests/${d1.id}/evidence?note=site-error`, { method: 'POST', headers: { 'content-type': 'image/png', authorization: `Bearer ${tReq}` }, body: png });
    assert.equal(up.status, 201);
  });
  await check('admin decides the disputer is RIGHT: stake refunded to them, trade refunded, other side struck', async () => {
    const before = REAL ? await bal(requester.address) : 0n;
    const r = await api('POST', `/requests/${d1.id}/resolve`, { token: tAdmin, body: { verdict: 'disputer_right', note: 'verified at the brand site' } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'refunded'); assert.equal(r.body.request.dispute.bond.status, 'returned');
    if (REAL) {
      assert.equal(await statusOf(d1.bondId), 3); assert.equal(await statusOf(escrowIdFor(d1.id)), 3); // both Refunded
      assert.equal((await bal(requester.address)) - before, AMOUNT_BASE + BOND_BASE); // trade amount AND stake came back
    }
    assert.equal((await api('GET', '/auth/me', { token: tFul })).body.user.reputation.strikes, 1);
  });
  let d2;
  await check('a second dispute: requester stakes, raises it, and the admin decides the disputer is WRONG', async () => {
    d2 = await disputedTrade('zomato');
    const h = await stake(d2.bondId);
    const r = await api('POST', `/requests/${d2.id}/dispute`, { token: tReq, body: { category: 'invalid_code', reason: 'Trying to get my crypto back', bondTxHash: h } });
    assert.equal(r.status, 200, r.text);
    const fulBefore = REAL ? await bal(fulfiller.address) : 0n;
    const res = await api('POST', `/requests/${d2.id}/resolve`, { token: tAdmin, body: { verdict: 'disputer_wrong', note: 'code is valid' } });
    assert.equal(res.status, 200, res.text); assert.equal(res.body.request.status, 'released'); assert.equal(res.body.request.dispute.bond.status, 'forfeited');
    if (REAL) {
      assert.equal(await statusOf(d2.bondId), 2); assert.equal(await statusOf(escrowIdFor(d2.id)), 2); // both Released
      const fee = ((AMOUNT_BASE + BOND_BASE) * (await pub.readContract({ address: contract, abi: ownerAbi, functionName: 'feeBps' }))) / 10000n;
      assert.ok((await bal(fulfiller.address)) - fulBefore >= AMOUNT_BASE + BOND_BASE - fee - 1n, 'the fulfiller must receive the trade AND the forfeited stake');
    }
  });
  await check('the false disputer is banned (cannot use the API any more)', async () => {
    const r = await api('GET', '/requests/mine', { token: tReq });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'banned');
  });

  if (REAL) {
    console.log('\n== 4. Tidy up: return the payout from the throwaway fulfiller (best effort) ==');
    await check('sweep fulfiller balance back to the depositor', async () => {
      const b = await bal(fulfiller.address); const send = b > 30000n ? b - 30000n : 0n;
      if (send > 0n) await tx(fulfiller, { address: USDC, abi: erc20, functionName: 'transfer', args: [getAddress(requester.address), send] });
    });
  }
} finally {
  backend.close();
}
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
process.exitCode = failed.length ? 1 : 0;
setTimeout(() => process.exit(), 300);
