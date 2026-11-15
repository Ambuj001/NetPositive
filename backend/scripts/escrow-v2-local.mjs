// End-to-end test of the backend in ESCROW_MODE=chain against the real VoucherEscrowV2 bytecode on a local chain (anvil).
// Nothing leaves this machine: the chain is a throwaway anvil process, USDC is a mock token, the database is the in-memory stand-in.
//
//   npm run chain:v2:local        (needs Foundry: `anvil` and `forge` on PATH)
//
// It proves the parts the mock-escrow tests cannot: that the server reads V2 state correctly, refuses to record a step the
// party has not sent from their wallet, sends only the timeout calls and the arbiter's ruling, and follows the chain.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, keccak256, parseEther, stringToHex, zeroHash } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { mockResult, WORLD_ID_TEST_ENV } from '../test-support/world-v4-mock.mjs';

const CONTRACTS = fileURLToPath(new URL('../../contracts/', import.meta.url));
const PORT = 8600 + Math.floor(Math.random() * 300);
const RPC = `http://127.0.0.1:${PORT}`;
const CHAIN_ID = 31337;
const FEE_BPS = 100;
const REVIEW = 3600;
const FULFILL = 7200;
const TTL = 86400;

// ---------- build + local chain ----------
const build = spawnSync('forge', ['build'], { cwd: CONTRACTS, encoding: 'utf8' });
if (build.status !== 0) { console.error('forge build failed:\n' + (build.stderr || build.error?.message)); process.exit(2); }
const artifact = (file, name) => JSON.parse(readFileSync(`${CONTRACTS}out/${file}/${name}.json`, 'utf8'));
const ESCROW = artifact('VoucherEscrowV2.sol', 'VoucherEscrowV2');
const USDC = artifact('Mocks.sol', 'MockUSDC');

const anvil = spawn('anvil', ['--port', String(PORT), '--chain-id', String(CHAIN_ID), '--silent'], { stdio: 'ignore' });
const stopAnvil = () => { try { anvil.kill(); } catch { /* already gone */ } };
process.on('exit', stopAnvil);

const chain = defineChain({ id: CHAIN_ID, name: 'local', nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const pub = createPublicClient({ chain, transport: http(RPC) });
const testClient = createTestClient({ chain, mode: 'anvil', transport: http(RPC) });
for (let i = 0; ; i++) {
  try { await pub.getChainId(); break; } catch { if (i > 50) { console.error('anvil did not start'); process.exit(2); } await new Promise((r) => setTimeout(r, 100)); }
}

const acct = () => privateKeyToAccount(generatePrivateKey());
const keeperKey = generatePrivateKey();
const arbiterKey = generatePrivateKey();
const [owner, spender, buyer, stranger, admin, treasury, reserve, guardian] = Array.from({ length: 8 }, acct);
const keeper = privateKeyToAccount(keeperKey);
const arbiter = privateKeyToAccount(arbiterKey);
for (const a of [owner, spender, buyer, stranger, keeper, arbiter]) await testClient.setBalance({ address: a.address, value: parseEther('10') });

const wallet = (a) => createWalletClient({ account: a, chain, transport: http(RPC) });
async function mined(hash) {
  const r = await pub.waitForTransactionReceipt({ hash });
  assert.equal(r.status, 'success', `tx reverted ${hash}`);
  return r;
}
async function deploy(a, art, args = []) {
  const r = await mined(await wallet(a).deployContract({ abi: art.abi, bytecode: art.bytecode.object, args }));
  return r.contractAddress;
}
const usdc = await deploy(owner, USDC);
const escrow = await deploy(owner, ESCROW, [owner.address, arbiter.address, guardian.address, treasury.address, reserve.address, FEE_BPS, 5000, REVIEW, FULFILL]);
const write = async (a, address, abi, functionName, args) => (await mined(await wallet(a).writeContract({ address, abi, functionName, args }))).transactionHash;
const onEscrow = (a, fn, args) => write(a, escrow, ESCROW.abi, fn, args);
const onUsdc = (a, fn, args) => write(a, usdc, USDC.abi, fn, args);
const bal = (a) => pub.readContract({ address: usdc, abi: USDC.abi, functionName: 'balanceOf', args: [a.address ?? a] });
const chainEscrow = (id) => pub.readContract({ address: escrow, abi: ESCROW.abi, functionName: 'getEscrow', args: [id] });
const BOND = 500_000n; // dispute stake
await onEscrow(owner, 'setToken', [usdc, true, 1_000n, 1_000_000_000n, 100_000_000_000n, BOND]);
await onUsdc(owner, 'mint', [spender.address, 10_000_000_000n]);
await onUsdc(spender, 'approve', [escrow, 2n ** 255n]);
const warp = async (seconds) => { await testClient.increaseTime({ seconds }); await testClient.mine({ blocks: 1 }); };

// ---------- backend, chain mode ----------
Object.assign(process.env, {
  NODE_ENV: 'development',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  VOUCHER_MODE: 'both',
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  ...WORLD_ID_TEST_ENV,
  SWEEP_INTERVAL_SECONDS: '0',
  DISPUTE_BOND_USDC: '0',
  CORS_ORIGINS: 'http://localhost:5173',
  ADMIN_ADDRESSES: admin.address,
  ARC_RPC_URL: RPC,
  ARC_CHAIN_ID: String(CHAIN_ID),
  ESCROW_MODE: 'chain',
  ESCROW_CONTRACT_ADDRESS: escrow,
  USDC_ADDRESS: usdc,
  ESCROW_KEEPER_PRIVATE_KEY: keeperKey,
  ESCROW_ARBITER_PRIVATE_KEY: arbiterKey,
  ESCROW_ORDER_TTL_SECONDS: String(TTL),
});
const { createApp } = await import('../src/app.js');
const { sweep } = await import('../src/services/requests.js');
const backend = createApp().listen(0);
const BASE = `http://127.0.0.1:${backend.address().port}`;

async function api(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: res.status, body: json, text };
}
async function signIn(a) {
  const n = await api('POST', '/auth/nonce', { body: { address: a.address } });
  const v = await api('POST', '/auth/verify', { body: { address: a.address, signature: await a.signMessage({ message: n.body.message }) } });
  assert.equal(v.status, 200, v.text);
  const w = await api('POST', '/world-id/verify', { token: v.body.token, body: mockResult({ address: a.address, nullifier: BigInt(`0x${crypto.randomBytes(16).toString('hex')}`) }) });
  assert.equal(w.status, 200, w.text);
  return v.body.token;
}

const results = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`  PASS  ${name}`); }
  catch (e) { results.push(false); console.log(`  FAIL  ${name}\n        ${String(e.shortMessage || e.message).replace(/\s+/g, ' ').slice(0, 500)}`); }
}
const statusOf = async (id) => (await api('GET', `/requests/${id}`)).body.request.status;
const AMOUNT = '25.5';
const AMOUNT_BASE = 25_500_000n;
const FEE_BASE = 255_000n;

let tS, tB, tA, tX;

/** Create an order and lock it from the spender's wallet. Returns the request as the server has it. */
async function fundedOrder() {
  const c = await api('POST', '/requests', { token: tS, body: { brand: 'amazon', amountInr: 2300, amountUsdc: AMOUNT } });
  assert.equal(c.status, 201, c.text);
  const req = c.body.request;
  const tx = await onEscrow(spender, 'deposit', [req.escrowRef, usdc, BigInt(req.amountUsdcBaseUnits), BigInt(c.body.escrow.ttlSeconds), BigInt(req.totalUsdcBaseUnits)]);
  const f = await api('POST', `/requests/${req.id}/fund`, { token: tS, body: { txHash: tx } });
  assert.equal(f.status, 200, f.text);
  assert.equal(f.body.request.status, 'open');
  return req;
}

/** Buyer accepts on the server, the spender signs Ready, the buyer binds on-chain. */
async function acceptedOnChain(req) {
  assert.equal((await api('POST', `/requests/${req.id}/accept`, { token: tB })).status, 200);
  const permit = await api('GET', `/requests/${req.id}/ready-permit`, { token: tS });
  assert.equal(permit.status, 200, permit.text);
  const { domain, types, primaryType, message } = permit.body.typedData;
  const { EIP712Domain: _omit, ...signTypes } = types;
  const signature = await spender.signTypedData({ domain, types: signTypes, primaryType, message: { ...message, validUntil: BigInt(message.validUntil) } });
  const ready = await api('POST', `/requests/${req.id}/ready`, { token: tS, body: { validUntil: permit.body.validUntil, signature } });
  assert.equal(ready.status, 200, ready.text);
  await onEscrow(buyer, 'accept', [req.escrowId, BigInt(permit.body.validUntil), signature]);
}

async function delivered(req) {
  await acceptedOnChain(req);
  await onEscrow(buyer, 'markDelivered', [req.escrowId, keccak256(stringToHex('sealed-envelope'))]);
  const s = await api('POST', `/requests/${req.id}/submit-code`, { token: tB, body: { code: 'ABCD-1234-EFGH', pin: '4321' } });
  assert.equal(s.status, 200, s.text);
  assert.equal(s.body.request.status, 'code_submitted');
  return s.body.request;
}

try {
  console.log(`\nBackend in chain mode against VoucherEscrowV2 on a local chain (${RPC}). Database: in-memory.\n`);
  tS = await signIn(spender); tB = await signIn(buyer); tA = await signIn(admin); tX = await signIn(stranger);

  console.log('== 1. Create and lock ==');
  let a;
  await check('the server quotes the fee from the contract and derives the same escrow id as the chain', async () => {
    const c = await api('POST', '/requests', { token: tS, body: { brand: 'amazon', amountInr: 2300, amountUsdc: AMOUNT } });
    assert.equal(c.status, 201, c.text);
    a = c.body.request;
    assert.equal(a.amountUsdcBaseUnits, String(AMOUNT_BASE));
    assert.equal(a.feeUsdcBaseUnits, String(FEE_BASE));
    assert.equal(a.totalUsdcBaseUnits, String(AMOUNT_BASE + FEE_BASE));
    assert.equal(a.escrowId, await pub.readContract({ address: escrow, abi: ESCROW.abi, functionName: 'escrowId', args: [spender.address, a.escrowRef] }));
    assert.deepEqual(c.body.escrow, { version: 2, contract: escrow, token: usdc, chainId: CHAIN_ID, ttlSeconds: TTL });
  });
  await check('fund is refused for a transaction that is not this deposit', async () => {
    const other = await onUsdc(spender, 'approve', [escrow, 2n ** 255n]);
    const r = await api('POST', `/requests/${a.id}/fund`, { token: tS, body: { txHash: other } });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'tx_wrong_contract');
  });
  await check('fund is refused when the deposit holds a different amount', async () => {
    const c = await api('POST', '/requests', { token: tS, body: { brand: 'amazon', amountInr: 2300, amountUsdc: AMOUNT } });
    const req = c.body.request;
    const tx = await onEscrow(spender, 'deposit', [req.escrowRef, usdc, 1_000_000n, BigInt(TTL), 2n ** 200n]);
    const r = await api('POST', `/requests/${req.id}/fund`, { token: tS, body: { txHash: tx } });
    assert.equal(r.status, 400); assert.equal(r.body.error, 'escrow_wrong_amount');
  });
  await check('deposit locks amount + fee, and fund publishes the order', async () => {
    const before = await bal(spender);
    const tx = await onEscrow(spender, 'deposit', [a.escrowRef, usdc, AMOUNT_BASE, BigInt(TTL), AMOUNT_BASE + FEE_BASE]);
    assert.equal(before - (await bal(spender)), AMOUNT_BASE + FEE_BASE);
    const r = await api('POST', `/requests/${a.id}/fund`, { token: tS, body: { txHash: tx } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'open');
  });

  await check('GET /escrow/terms reports the contract\'s fee, limits, stake and windows', async () => {
    const r = await api('GET', '/escrow/terms');
    assert.equal(r.status, 200, r.text);
    assert.deepEqual({ ...r.body, lockedBaseUnits: 'x' }, { version: 2, mode: 'chain', chainId: CHAIN_ID, token: usdc, orderTtlSeconds: TTL, contract: escrow, feeBps: FEE_BPS, disputeBondBaseUnits: String(BOND), minBaseUnits: '1000', maxBaseUnits: '1000000000', capBaseUnits: '100000000000', lockedBaseUnits: 'x', reviewWindowSeconds: REVIEW, fulfillWindowSeconds: FULFILL, paused: false });
    assert.ok(BigInt(r.body.lockedBaseUnits) > 0n, 'the live deposits are counted');
    const h = await fetch(BASE + '/health');
    assert.equal(h.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(h.headers.get('x-frame-options'), 'DENY');
  });

  await check('POST /escrow/rpc relays read calls for the escrow and USDC only', async () => {
    const data = '0x' + 'f023b811' + a.escrowId.slice(2);
    let r = await api('POST', '/escrow/rpc', { body: { jsonrpc: '2.0', id: 7, method: 'eth_call', params: [{ to: escrow, data }, 'latest'] } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.id, 7); assert.ok(r.body.result.length > 66, 'returns the escrow record');
    r = await api('POST', '/escrow/rpc', { body: [{ jsonrpc: '2.0', id: 1, method: 'eth_chainId', params: [] }, { jsonrpc: '2.0', id: 2, method: 'eth_call', params: [{ to: stranger.address, data: '0x' }, 'latest'] }, { jsonrpc: '2.0', id: 3, method: 'eth_sendRawTransaction', params: ['0x00'] }] });
    assert.equal(Number(BigInt(r.body[0].result)), CHAIN_ID);
    assert.ok(r.body[1].error, 'calls to other contracts are refused');
    assert.ok(r.body[2].error, 'sending is never relayed');
    r = await api('POST', '/escrow/rpc', { body: { jsonrpc: '2.0', id: 1, method: 'eth_estimateGas', params: [{ from: spender.address, to: escrow, data: '0xc4d252f5' + a.escrowId.slice(2) }] } });
    assert.ok(r.body.result || r.body.error, 'estimates are relayed (result or the node\'s revert)');
  });

  console.log('\n== 2. Happy path: the parties move the money, the server only records it ==');
  await check('submit-code is refused until the buyer is bound on-chain', async () => {
    assert.equal((await api('POST', `/requests/${a.id}/accept`, { token: tB })).status, 200);
    const r = await api('POST', `/requests/${a.id}/submit-code`, { token: tB, body: { code: 'ABCD-1234-EFGH' } });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'not_assigned_onchain'); assert.equal(r.body.details.function, 'accept');
  });
  let permitA;
  await check('the Ready permit is the escrow\'s Assign message; a forged one is refused, the real one binds the buyer on-chain', async () => {
    const p = await api('GET', `/requests/${a.id}/ready-permit`, { token: tS });
    assert.equal(p.body.typedData.primaryType, 'Assign');
    assert.equal(p.body.typedData.domain.verifyingContract, escrow);
    const { EIP712Domain: _omit, ...types } = p.body.typedData.types;
    const sign = (who) => who.signTypedData({ domain: p.body.typedData.domain, types, primaryType: 'Assign', message: { ...p.body.typedData.message, validUntil: BigInt(p.body.validUntil) } });
    const forged = await api('POST', `/requests/${a.id}/ready`, { token: tS, body: { validUntil: p.body.validUntil, signature: await sign(stranger) } });
    assert.equal(forged.body.error, 'bad_ready_signature');
    const signature = await sign(spender);
    assert.equal((await api('POST', `/requests/${a.id}/ready`, { token: tS, body: { validUntil: p.body.validUntil, signature } })).status, 200);
    permitA = { validUntil: BigInt(p.body.validUntil), signature };
    await assert.rejects(onEscrow(stranger, 'accept', [a.escrowId, permitA.validUntil, signature]), 'the permit names the buyer; nobody else can use it');
    await onEscrow(buyer, 'accept', [a.escrowId, permitA.validUntil, signature]);
    assert.equal((await chainEscrow(a.escrowId)).fulfiller, buyer.address);
  });
  await check('submit-code is refused until markDelivered, then accepted with the chain\'s review deadline', async () => {
    let r = await api('POST', `/requests/${a.id}/submit-code`, { token: tB, body: { code: 'ABCD-1234-EFGH' } });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'not_delivered_onchain');
    await onEscrow(buyer, 'markDelivered', [a.escrowId, zeroHash]);
    r = await api('POST', `/requests/${a.id}/submit-code`, { token: tB, body: { code: 'ABCD-1234-EFGH' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(Date.parse(r.body.request.reviewDeadline) / 1000, Number((await chainEscrow(a.escrowId)).deadline));
  });
  await check('confirm is refused until the spender sends release(); the server cannot pay the buyer itself', async () => {
    const before = await bal(buyer);
    const r = await api('POST', `/requests/${a.id}/confirm`, { token: tS });
    assert.equal(r.status, 409); assert.equal(r.body.error, 'wallet_action_required');
    assert.deepEqual(r.body.details, { function: 'release', escrowId: a.escrowId });
    assert.equal(await statusOf(a.id), 'code_submitted');
    assert.equal(await bal(buyer), before);
  });
  await check('after release() the buyer has exactly the amount, the fee stays in the contract, and confirm records it', async () => {
    const before = await bal(buyer);
    await onEscrow(spender, 'release', [a.escrowId]);
    assert.equal((await bal(buyer)) - before, AMOUNT_BASE);
    assert.equal(await pub.readContract({ address: escrow, abi: ESCROW.abi, functionName: 'accruedFees', args: [usdc] }), FEE_BASE);
    const r = await api('POST', `/requests/${a.id}/confirm`, { token: tS });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'released');
    assert.equal(r.body.request.releaseTxHash, 'settled-on-chain');
  });

  console.log('\n== 3. Cancel ==');
  await check('cancel is refused until the spender sends cancel(), then records a full refund (fee included)', async () => {
    const before = await bal(spender);
    const req = await fundedOrder();
    let r = await api('POST', `/requests/${req.id}/cancel`, { token: tS });
    assert.equal(r.status, 409); assert.deepEqual(r.body.details, { function: 'cancel', escrowId: req.escrowId });
    assert.equal(await statusOf(req.id), 'open');
    await onEscrow(spender, 'cancel', [req.escrowId]);
    assert.equal(await bal(spender), before);
    r = await api('POST', `/requests/${req.id}/cancel`, { token: tS });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'refunded');
  });
  await check('a buyer who only accepted on the server does not stop the spender cancelling; the server state endpoint matches the chain', async () => {
    const before = await bal(spender);
    const req = await fundedOrder();
    assert.equal((await api('POST', `/requests/${req.id}/accept`, { token: tB })).status, 200);
    const st = await api('GET', `/escrow/state/${req.escrowId}`);
    assert.equal(st.status, 200, st.text);
    assert.equal(st.body.escrow.status, 'funded'); assert.equal(st.body.escrow.statusCode, 1); assert.equal(st.body.escrow.fulfiller, null);
    assert.equal(st.body.escrow.amount, String(AMOUNT_BASE)); assert.equal(st.body.escrow.depositor, spender.address.toLowerCase());
    let r = await api('POST', `/requests/${req.id}/cancel`, { token: tS });
    assert.equal(r.status, 409); assert.equal(r.body.details.function, 'cancel');
    await onEscrow(spender, 'cancel', [req.escrowId]);
    r = await api('POST', `/requests/${req.id}/cancel`, { token: tS });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'refunded');
    assert.equal(await bal(spender), before);
  });
  await check('once a buyer is bound on-chain the spender can no longer cancel', async () => {
    const req = await fundedOrder();
    await acceptedOnChain(req);
    await assert.rejects(onEscrow(spender, 'cancel', [req.escrowId]));
    // tidy up: the buyer steps away, the spender cancels
    await onEscrow(buyer, 'unassign', [req.escrowId]);
    await onEscrow(spender, 'cancel', [req.escrowId]);
    await sweep();
    assert.equal(await statusOf(req.id), 'refunded');
  });

  console.log('\n== 4. Timeouts: the keeper sends only what anyone may send ==');
  await check('spender silent after delivery: after the review window the sweep pays the buyer with claim()', async () => {
    const req = await fundedOrder();
    await delivered(req);
    const before = await bal(buyer);
    let s = await sweep();
    assert.equal(await statusOf(req.id), 'code_submitted', 'nothing is paid before the window ends');
    await warp(REVIEW + 1);
    s = await sweep();
    assert.equal(s.errors, 0);
    assert.equal(await statusOf(req.id), 'released');
    assert.equal((await bal(buyer)) - before, AMOUNT_BASE);
    assert.equal(await bal(keeper), 0n, 'the keeper never receives funds');
  });
  await check('an order nobody takes is refunded by the sweep after it expires', async () => {
    const before = await bal(spender);
    const req = await fundedOrder();
    await warp(TTL + 1);
    const s = await sweep();
    assert.equal(s.errors, 0);
    assert.equal(await statusOf(req.id), 'refunded');
    assert.equal(await bal(spender), before);
  });
  await check('a bound buyer who never delivers: the order is refunded after their deadline, not reopened', async () => {
    const before = await bal(spender);
    const req = await fundedOrder();
    await acceptedOnChain(req);
    await warp(FULFILL + 1);
    await sweep();
    assert.equal(await statusOf(req.id), 'refunded');
    assert.equal(await bal(spender), before);
  });
  await check('the server follows a release the spender sent without telling it', async () => {
    const req = await fundedOrder();
    await delivered(req);
    await onEscrow(spender, 'release', [req.escrowId]);
    await sweep();
    assert.equal(await statusOf(req.id), 'released');
  });

  console.log('\n== 5. Disputes: only the arbiter\'s ruling, only on a disputed escrow ==');
  let d;
  await check('a dispute is refused until the spender sends dispute(); the buyer cannot open one', async () => {
    d = await fundedOrder();
    await delivered(d);
    let r = await api('POST', `/requests/${d.id}/dispute`, { token: tS, body: { category: 'already_redeemed', reason: 'The code was already used when I tried it' } });
    assert.equal(r.status, 409); assert.deepEqual(r.body.details, { function: 'dispute', escrowId: d.escrowId });
    r = await api('POST', `/requests/${d.id}/dispute`, { token: tB, body: { category: 'code_is_valid', reason: 'The code is fine, I checked it' } });
    assert.equal(r.status, 403); assert.equal(r.body.error, 'buyer_dispute_unavailable');
    r = await api('POST', `/requests/${d.id}/dispute/bond`, { token: tS });
    assert.equal(r.body.bond.required, false); assert.equal(r.body.bond.onchain, true);
    assert.equal(r.body.bond.amountBaseUnits, String(BOND), 'the server reports the stake the contract will lock');
    const beforeStake = await bal(spender);
    await onEscrow(spender, 'dispute', [d.escrowId, keccak256(stringToHex('already used'))]);
    assert.equal(beforeStake - (await bal(spender)), BOND, 'dispute() locks the stake');
    r = await api('POST', `/requests/${d.id}/dispute`, { token: tS, body: { category: 'already_redeemed', reason: 'The code was already used when I tried it' } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'disputed');
  });
  await check('a disputed escrow is frozen: the review timeout no longer pays the buyer', async () => {
    const before = await bal(buyer);
    await warp(REVIEW + 1);
    await sweep();
    assert.equal(await statusOf(d.id), 'disputed');
    assert.equal(await bal(buyer), before);
  });
  await check('admin rules for the spender: the arbiter refunds everything, fee and stake included', async () => {
    const before = await bal(spender);
    const r = await api('POST', `/requests/${d.id}/resolve`, { token: tA, body: { verdict: 'disputer_right' } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'refunded');
    assert.equal((await bal(spender)) - before, AMOUNT_BASE + FEE_BASE + BOND);
    assert.equal(Number((await chainEscrow(d.escrowId)).status), 6); // Resolved
  });
  await check('the arbiter key has no power over an escrow that is not disputed', async () => {
    const req = await fundedOrder();
    await delivered(req);
    await assert.rejects(onEscrow(arbiter, 'resolve', [req.escrowId, AMOUNT_BASE]));
    await assert.rejects(onEscrow(keeper, 'release', [req.escrowId]));
    await onEscrow(spender, 'release', [req.escrowId]);
    await sweep();
  });
  await check('admin rules for the buyer: the arbiter pays the buyer the amount plus the forfeited stake (and the spender is banned)', async () => {
    const req = await fundedOrder();
    await delivered(req);
    await onEscrow(spender, 'dispute', [req.escrowId, zeroHash]);
    assert.equal((await api('POST', `/requests/${req.id}/dispute`, { token: tS, body: { category: 'invalid_code', reason: 'It says the code does not exist' } })).status, 200);
    const before = await bal(buyer);
    const r = await api('POST', `/requests/${req.id}/resolve`, { token: tA, body: { verdict: 'disputer_wrong' } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'released');
    assert.equal((await bal(buyer)) - before, AMOUNT_BASE + BOND);
  });

  console.log('\n== 6. Books balance ==');
  await check('the contract holds exactly its unwithdrawn fees; nothing is stuck', async () => {
    const fees = await pub.readContract({ address: escrow, abi: ESCROW.abi, functionName: 'accruedFees', args: [usdc] });
    const locked = await pub.readContract({ address: escrow, abi: ESCROW.abi, functionName: 'totalLocked', args: [usdc] });
    // the under-funded test deposit from section 1 is still live; everything else has ended
    assert.equal(locked, 1_000_000n + 10_000n);
    assert.equal(await bal(escrow), fees + locked);
    assert.equal(await bal(stranger), 0n);
  });
  void tX;
} finally {
  backend.close();
  stopAnvil();
}

const passed = results.filter(Boolean).length;
console.log(`\n==== ${passed}/${results.length} checks passed ====`);
process.exit(passed === results.length ? 0 : 1);
