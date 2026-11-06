// End-to-end test of the Express backend against the DEPLOYED escrow on Arc testnet (contract "A", contracts/src/VoucherEscrow.sol).
// Database: always the in-memory stand-in (nothing is written to Firestore). Chain: REAL, only when explicitly confirmed.
//
// DRY RUN (default; escrow is mocked, no chain access, validates this script and the backend flow):
//   node --import ./test-support/register.mjs scripts/chain-e2e.mjs
// REAL TESTNET RUN (sends real transactions; spends ~0.2 testnet USDC + gas, most of it returned):
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
import { mockResult } from '../test-support/world-mock.mjs';

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
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_MOCK: 'true',
  SWEEP_INTERVAL_SECONDS: '0',
  CORS_ORIGINS: 'http://localhost:3000',
  ARC_RPC_URL: RPC,
  ARC_CHAIN_ID: String(CHAIN_ID),
  ESCROW_MODE: REAL ? 'chain' : 'mock',
  ...(REAL && { ESCROW_CONTRACT_ADDRESS: contract, ESCROW_OPERATOR_PRIVATE_KEY: operatorKey }),
});

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
  const wreq = await api('POST', '/world-id/request', { token });
  const w = await api('POST', '/world-id/verify', { token, body: mockResult({ request: wreq.body, nullifier: BigInt(`0x${crypto.randomBytes(16).toString('hex')}`) }) });
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
    await check(`depositor holds enough USDC (needs >= 0.2, has ${formatUnits(await bal(requester.address), 6)})`, async () => assert.ok((await bal(requester.address)) >= 2n * AMOUNT_BASE + 50000n));
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
