// FULL end-to-end trade with the real deployed contracts, the real backend and the real chatbot server.
//
//   Shivam (requester, has USDC)  --USDC via the VoucherEscrow-->  Saad (fulfiller)     [deposit -> release]
//   Saad                          --voucher code via CodeMailbox--> Shivam              [sealed box, on-chain, wallet-derived key]
//
// Real: Arc testnet escrow + KeyRegistry + CodeMailbox (transactions), the Express backend, the Python chatbot server,
//       optionally the real Firestore. MOCKED: World ID only (it needs a real person with the World App), and the voucher
//       code itself is a synthetic value (nothing is bought).
//
// DRY RUN (default; mock escrow, in-memory DB, on-chain steps skipped; validates the script and the off-chain logic):
//   node scripts/full-e2e.mjs
// REAL ARC (sends ~12 transactions; ~0.1 testnet USDC of gas):
//   OPERATOR_PK=<escrow operator key> CONFIRM_CHAIN_TX=<escrow address> node scripts/full-e2e.mjs
// REAL ARC + REAL FIRESTORE (requests show up in the Firebase console; nothing is deleted by default):
//   OPERATOR_PK=... CONFIRM_CHAIN_TX=... SA_PATH=<service-account.json> CONFIRM_REAL_FIRESTORE=<project_id> \
//     MANIFEST=<where to write the manifest> node scripts/full-e2e.mjs
// CLEANUP of exactly what a Firestore run created (reads its manifest):
//   SA_PATH=... CONFIRM_REAL_FIRESTORE=<project_id> MANIFEST=<manifest.json> node scripts/full-e2e.mjs --cleanup
//
// SAFETY: keys are read only from the environment (never printed or written); real chain needs CONFIRM_CHAIN_TX == escrow address;
// real Firestore needs CONFIRM_REAL_FIRESTORE == the key's project_id; every Firestore doc created is recorded in a manifest and
// cleanup deletes only manifest entries (a user doc that already existed before the run is never recorded or deleted).
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { register } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient, createWalletClient, custom, defineChain, formatUnits, getAddress, hexToString, http, keccak256,
  parseAbi, parseAbiItem, recoverMessageAddress, stringToHex, toHex,
} from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import * as V from '../vault-sdk/index.js';
import { mockResult, WORLD_ID_TEST_ENV } from '../test-support/world-v4-mock.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const chatbotDir = path.resolve(here, '../../chatbot');
const ptDir = path.resolve(here, '../../contracts/private-transfer');
const REAL_CHAIN = Boolean(process.env.CONFIRM_CHAIN_TX);
const REAL_DB = Boolean(process.env.SA_PATH);
const CLEANUP = process.argv.includes('--cleanup');
const MANIFEST = process.env.MANIFEST || path.join(os.tmpdir(), `np-full-e2e-manifest-${Date.now()}.json`);
const RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io';
const CHAIN_ID = 5042002;
const USDC = '0x3600000000000000000000000000000000000000';
const AMOUNT_BASE = 100_000n; // 0.10 USDC
const CODE = { code: '9000111122223333', pin: '424242' }; // synthetic, not a real voucher

// ---------------- environment ----------------
delete process.env.FIRESTORE_EMULATOR_HOST;
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let projectId = 'demo-netpositive';
if (REAL_DB) {
  const sa = JSON.parse(fs.readFileSync(process.env.SA_PATH, 'utf8'));
  projectId = sa.project_id;
  if (process.env.CONFIRM_REAL_FIRESTORE !== projectId) { console.error(`Refusing to touch a REAL Firestore. Re-run with CONFIRM_REAL_FIRESTORE=${projectId}`); process.exit(2); }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.SA_PATH;
} else {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) { console.error('Refusing: real Firebase credentials are in the environment but SA_PATH was not given. Unset them for an in-memory run.'); process.exit(2); }
  register('../test-support/hooks.mjs', import.meta.url); // in-memory Firestore stand-in
}
const dep = JSON.parse(fs.readFileSync(path.join(ptDir, 'deployments', 'arc-testnet.json'), 'utf8'));
const ESCROW = getAddress(dep.escrow), REGISTRY = getAddress(dep.keyRegistry.address), MAILBOX = getAddress(dep.codeMailbox.address);
let operatorKey = null;
if (REAL_CHAIN) {
  if (process.env.CONFIRM_CHAIN_TX.toLowerCase() !== ESCROW.toLowerCase()) { console.error('Refusing a REAL chain run: CONFIRM_CHAIN_TX must equal the escrow address.'); process.exit(2); }
  if (!process.env.OPERATOR_PK) { console.error('OPERATOR_PK is required for a real chain run.'); process.exit(2); }
  operatorKey = `0x${process.env.OPERATOR_PK.replace(/^0x/, '')}`;
}
const adminKeys = V.deriveVaultKeys(`0x${crypto.randomBytes(65).toString('hex')}`); // offline dispute key (generated for this run)
Object.assign(process.env, {
  NODE_ENV: 'development',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  FIREBASE_PROJECT_ID: projectId,
  ...WORLD_ID_TEST_ENV,
  SWEEP_INTERVAL_SECONDS: '0',
  CORS_ORIGINS: 'http://localhost:3000',
  ARC_RPC_URL: RPC,
  ARC_CHAIN_ID: String(CHAIN_ID),
  ESCROW_MODE: REAL_CHAIN ? 'chain' : 'mock',
  VOUCHER_MODE: 'sealed', // the server must never see a plaintext code in this run
  ADMIN_VAULT_PUBLIC_KEY: adminKeys.publicKeyHex,
  ...(REAL_CHAIN && { ESCROW_CONTRACT_ADDRESS: ESCROW, ESCROW_OPERATOR_PRIVATE_KEY: operatorKey }),
});

const { createApp } = await import('../src/app.js');
const { col, voucherRef, eventsRef } = await import('../src/services/firestore.js');
const { escrowIdFor, ESCROW_ABI } = await import('../src/services/escrow.js');

const consoleUrl = (p) => `https://console.firebase.google.com/project/${projectId}/firestore/databases/-default-/data/~2F${p.split('/').join('~2F')}`;

// ---------------- cleanup mode ----------------
if (CLEANUP) {
  if (!REAL_DB || !process.env.MANIFEST) { console.error('--cleanup needs SA_PATH, CONFIRM_REAL_FIRESTORE and MANIFEST'); process.exit(2); }
  const m = JSON.parse(fs.readFileSync(MANIFEST, 'utf8'));
  assert.equal(m.projectId, projectId, 'manifest belongs to a different project');
  let n = 0;
  for (const id of m.created.requests) {
    for (const sub of ['events', 'private']) for (const d of (await col.requests.doc(id).collection(sub).get()).docs) { await d.ref.delete(); n++; }
    await col.requests.doc(id).delete(); n++;
  }
  for (const a of m.created.users) {
    for (const d of (await col.users.doc(a).collection('vaultState').get()).docs) { await d.ref.delete(); n++; }
    await col.users.doc(a).delete(); n++;
  }
  for (const h of m.created.nullifiers) { await col.nullifiers.doc(h).delete(); n++; }
  console.log(`Deleted ${n} documents listed in the manifest. Nothing else was touched.`);
  process.exit(0);
}

// ---------------- chain clients (throttled: the public RPC rejects bursts) ----------------
const chain = defineChain({ id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
const rawHttp = http(RPC, { timeout: 30000, retryCount: 0 })({ chain, retryCount: 0 });
let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transport = custom({
  async request(args) {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCall + 350 - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      try { return await rawHttp.request(args); } catch (e) {
        if (attempt < 10 && /exceeds defined limit|rate|429|timeout|timed out|fetch failed|too many/i.test(String(e.shortMessage || e.message))) { await sleep(800 * (attempt + 1)); continue; }
        throw e;
      }
    }
  },
});
const pub = createPublicClient({ chain, transport });
const wc = (account) => createWalletClient({ account, chain, transport });
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const escrowRead = parseAbi(['function operator() view returns (address)']);
const art = (n) => JSON.parse(fs.readFileSync(path.join(ptDir, 'build', `${n}.json`), 'utf8'));
let registryAbi, mailboxAbi;
if (REAL_CHAIN) { registryAbi = art('KeyRegistry').abi; mailboxAbi = art('CodeMailbox').abi; }
const deliveredEvent = parseAbiItem('event Delivered(bytes32 indexed escrowId, address indexed fulfiller, address indexed recipient, bytes8 keyId, bytes32 ciphertextHash, uint64 deliveredAt, bytes ciphertext)');
const txs = [];
async function sendTx(account, label, params) {
  const hash = await wc(account).writeContract(params);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  assert.equal(r.status, 'success', `${label} reverted (${hash})`);
  txs.push({ label, hash, gas: Number(r.gasUsed) });
  return r;
}

// ---------------- harness ----------------
const results = [];
const skipped = [];
async function check(name, fn) {
  try { await fn(); results.push(true); console.log(`  PASS  ${name}`); }
  catch (e) { results.push(false); console.log(`  FAIL  ${name}\n        ${String(e.shortMessage || e.message).replace(/\s+/g, ' ').slice(0, 400)}`); }
}
const chainCheck = (name, fn) => (REAL_CHAIN ? check(name, fn) : (skipped.push(name), console.log(`  SKIP  ${name}  (needs a real chain run)`)));
const backend = createApp().listen(0);
const BASE = `http://127.0.0.1:${backend.address().port}`;
async function http_(base, method, p, { token, body } = {}) {
  const res = await fetch(base + p, { method, headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text(); let json; try { json = JSON.parse(text); } catch { json = {}; }
  return { status: res.status, body: json, text };
}
const api = (m, p, o) => http_(BASE, m, p, o);
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const botPort = await freePort();
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-full-'));
const bot = spawn('python', ['server.py'], { cwd: chatbotDir, env: { ...process.env, PORT: String(botPort), NETPOSITIVE_STATE_FILE: path.join(stateDir, 'pf.json'), PYTHONIOENCODING: 'utf-8' }, stdio: ['ignore', 'ignore', 'ignore'] });
const CHATBOT = `http://127.0.0.1:${botPort}`;
const chat = (m, p, o) => http_(CHATBOT, m, p, o);
for (let i = 0; i < 80; i++) { try { if ((await fetch(`${CHATBOT}/health`)).ok) break; } catch { await sleep(250); } }

const created = { users: [], nullifiers: [], requests: [] };
const saveManifest = () => REAL_DB && fs.writeFileSync(MANIFEST, JSON.stringify({ projectId, created }, null, 2));
let nullifierCounter = BigInt(`0x${crypto.randomBytes(12).toString('hex')}`);
async function signIn(acct) {
  const addr = acct.address.toLowerCase();
  const pre = await col.users.doc(addr).get();
  const n = await api('POST', '/auth/nonce', { body: { address: acct.address } });
  const v = await api('POST', '/auth/verify', { body: { address: acct.address, signature: await acct.signMessage({ message: n.body.message }) } });
  assert.equal(v.status, 200, v.text);
  if (!pre.exists) created.users.push(addr); // never record (and so never delete) a user doc that already existed
  const nul = ++nullifierCounter;
  const w = await api('POST', '/world-id/verify', { token: v.body.token, body: mockResult({ address: acct.address, nullifier: nul }) });
  assert.equal(w.status, 200, w.text);
  created.nullifiers.push(`0x${nul.toString(16).padStart(64, '0')}`);
  saveManifest();
  return v.body.token;
}

const shivam = REAL_CHAIN ? privateKeyToAccount(operatorKey) : privateKeyToAccount(generatePrivateKey()); // requester (also the escrow operator, as in the earlier chain test)
const saad = privateKeyToAccount(generatePrivateKey()); // fulfiller, throwaway
const bal = (a) => pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [a] });
let tS, tA, keys, requestId, escrowId, draft, startNative = 0n;

try {
  console.log(`\nChain: ${REAL_CHAIN ? 'REAL Arc testnet (escrow + KeyRegistry + CodeMailbox)' : 'SKIPPED (dry run)'}   Database: ${REAL_DB ? `REAL Firestore (${projectId})` : 'in-memory stand-in'}   World ID: MOCK   Chatbot: real server`);
  console.log(`Escrow ${ESCROW}\nKeyRegistry ${REGISTRY}\nCodeMailbox ${MAILBOX}\n`);

  console.log('== 0. Preconditions ==');
  if (REAL_CHAIN) {
    await check('Arc testnet; escrow, registry and mailbox all have code; the key is the escrow operator', async () => {
      assert.equal(await pub.getChainId(), CHAIN_ID);
      for (const a of [ESCROW, REGISTRY, MAILBOX]) assert.ok((await pub.getCode({ address: a }))?.length > 2, `no code at ${a}`);
      assert.equal(getAddress(await pub.readContract({ address: ESCROW, abi: escrowRead, functionName: 'operator' })), shivam.address);
      startNative = await pub.getBalance({ address: shivam.address });
      assert.ok(startNative > 10n ** 17n, 'operator wallet has less than 0.1 USDC');
    });
  }
  await check('chatbot server and backend are up; backend is in sealed-only voucher mode', async () => {
    assert.equal((await chat('GET', '/health')).status, 200);
    const c = (await api('GET', '/vault/config')).body;
    assert.equal(c.mode, 'sealed'); assert.equal(c.adminPublicKey, adminKeys.publicKeyHex);
  });

  console.log('\n== 1. Sign-in (wallet signatures real; World ID mocked) ==');
  await check('Shivam (requester) and Saad (fulfiller) sign in', async () => { tS = await signIn(shivam); tA = await signIn(saad); });

  console.log('\n== 1b. Chatbot login (same token as the backend) ==');
  await check("chatbot rejects calls with no token, and Shivam cannot use Saad's portfolio", async () => {
    const sid = saad.address.toLowerCase();
    assert.equal((await chat('POST', '/portfolio/add', { body: { user_id: sid, card: 'HDFC Infinia' } })).status, 401);
    assert.equal((await chat('POST', '/portfolio/add', { token: tS, body: { user_id: sid, card: 'HDFC Infinia' } })).status, 403);
    assert.equal((await chat('POST', '/portfolio/add', { token: tA, body: { card: 'HDFC Infinia' } })).body.ok, true); // user comes from the token
    const r = (await chat('POST', '/request/fulfil', { token: tA, body: { brand: 'Amazon', amount: 9 } })).body;
    assert.equal(r.options[0].card, 'HDFC Infinia');
    assert.deepEqual((await chat('GET', '/portfolio', { token: tS })).body.cards, []);
  });

  console.log('\n== 2. Chatbot: what does Shivam want? ==');
  await check('"nike shoes from amazon" -> Amazon locked; draft request', async () => {
    const s = await chat('POST', '/merchants/suggest', { body: { query: 'nike shoes from amazon' } });
    assert.equal(s.body.selected.merchant_id, 'amazon');
    draft = (await chat('POST', '/request/draft', { body: { merchant: 'amazon', amount: 9, item: 'Nike shoes' } })).body; // Rs 9 at Rs 90/USDC = 0.10 USDC
    assert.equal(draft.ok, true);
  });

  console.log('\n== 3. Shivam creates the request (backend) ==');
  await check('POST /requests -> pending_funding with the escrow id the contract uses', async () => {
    const r = await api('POST', '/requests', { token: tS, body: { brand: draft.request.merchant_id, amountInr: draft.request.amount_inr, amountUsdc: '0.10' } });
    assert.equal(r.status, 201, r.text);
    requestId = r.body.request.id; escrowId = keccak256(stringToHex(requestId));
    created.requests.push(requestId); saveManifest();
    assert.equal(r.body.request.status, 'pending_funding'); assert.equal(r.body.request.escrowId, escrowId);
    assert.equal(r.body.request.amountUsdcBaseUnits, String(AMOUNT_BASE));
  });

  console.log('\n== 4. Shivam -> escrow: vault key on-chain and USDC deposit (REAL) ==');
  keys = V.deriveVaultKeys(await shivam.signMessage({ message: V.KEY_MESSAGE }));
  await check('Shivam derives his vault key from a wallet signature (deterministic)', async () => {
    V.assertDeterministicSignature(await shivam.signMessage({ message: V.KEY_MESSAGE }), await shivam.signMessage({ message: V.KEY_MESSAGE }));
  });
  await check('Shivam registers the vault key with the backend (wallet-signed binding)', async () => {
    const signature = await shivam.signMessage({ message: V.keyBindingMessage(shivam.address, keys.publicKeyHex) });
    assert.equal((await api('PUT', '/vault/key', { token: tS, body: { publicKey: keys.publicKeyHex, signature } })).status, 200);
  });
  await chainCheck('Shivam registers the same key in the on-chain KeyRegistry', async () => {
    await sendTx(shivam, 'KeyRegistry.setKey', { address: REGISTRY, abi: registryAbi, functionName: 'setKey', args: [`0x${keys.publicKeyHex}`] });
    assert.equal((await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'keyOf', args: [shivam.address] }))[0], `0x${keys.publicKeyHex}`);
  });
  let depositTx = `0x${crypto.randomBytes(32).toString('hex')}`;
  await chainCheck('Shivam approves and deposits 0.10 USDC into the real escrow', async () => {
    await sendTx(shivam, 'USDC.approve', { address: USDC, abi: erc20, functionName: 'approve', args: [ESCROW, AMOUNT_BASE] });
    depositTx = (await sendTx(shivam, 'Escrow.deposit', { address: ESCROW, abi: ESCROW_ABI, functionName: 'deposit', args: [escrowId, AMOUNT_BASE] })).transactionHash;
    const [d, a, s] = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'escrows', args: [escrowId] });
    assert.equal(d, shivam.address); assert.equal(a, AMOUNT_BASE); assert.equal(s, 1);
  });
  await check('POST /requests/:id/fund: the backend verifies the deposit against the chain -> open', async () => {
    const r = await api('POST', `/requests/${requestId}/fund`, { token: tS, body: { txHash: depositTx } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'open');
  });

  console.log('\n== 5. Saad takes the job; Shivam signs "Ready" for Saad ==');
  await check('Saad accepts the request', async () => {
    const r = await api('POST', `/requests/${requestId}/accept`, { token: tA });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.fulfiller, saad.address.toLowerCase());
  });
  let readySig, validUntil;
  await chainCheck('Shivam signs the gasless Ready permit (EIP-712, Arc chain id, bound to Saad and this escrow)', async () => {
    validUntil = BigInt((await pub.getBlock()).timestamp) + 900n;
    readySig = await shivam.signTypedData({
      domain: { name: 'NetPositiveCodeMailbox', version: '1', chainId: CHAIN_ID, verifyingContract: MAILBOX },
      types: { Ready: [{ name: 'escrowId', type: 'bytes32' }, { name: 'fulfiller', type: 'address' }, { name: 'validUntil', type: 'uint64' }] },
      primaryType: 'Ready', message: { escrowId, fulfiller: saad.address, validUntil },
    });
  });
  await chainCheck('Saad is given a little gas money (he pays for his own delivery transaction)', async () => {
    const hash = await wc(shivam).sendTransaction({ to: saad.address, value: 30_000_000_000_000_000n }); // 0.03 USDC native
    await pub.waitForTransactionReceipt({ hash }); txs.push({ label: 'gas money to Saad', hash });
  });

  console.log('\n== 6. Saad -> Shivam: the voucher code through the mailbox (REAL) ==');
  let envelope, ciphertextHex, deliverReceipt;
  await check('Saad reads Shivam\'s key (from the backend AND the chain), checks they agree and that Shivam signed it, then seals the code', async () => {
    const k = (await api('GET', `/vault/key/${shivam.address.toLowerCase()}`, { token: tA })).body.key;
    assert.equal((await recoverMessageAddress({ message: V.keyBindingMessage(k.address, k.publicKey), signature: k.signature })).toLowerCase(), shivam.address.toLowerCase());
    if (REAL_CHAIN) assert.equal((await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'keyOf', args: [shivam.address] }))[0].slice(2), k.publicKey, 'on-chain key differs from the backend key');
    envelope = V.seal(CODE, [k.publicKey, adminKeys.publicKeyHex], V.voucherAad(requestId, shivam.address, saad.address));
    ciphertextHex = toHex(new TextEncoder().encode(JSON.stringify(envelope)));
  });
  await chainCheck('Saad calls CodeMailbox.deliver() on Arc', async () => {
    deliverReceipt = await sendTx(saad, 'CodeMailbox.deliver', { address: MAILBOX, abi: mailboxAbi, functionName: 'deliver', args: [escrowId, `0x${V.keyId(keys.publicKeyHex)}`, ciphertextHex, validUntil, readySig] });
  });
  await check('Saad submits the same sealed box to the backend (drives the request state machine) -> code_submitted', async () => {
    const r = await api('POST', `/requests/${requestId}/submit-code`, { token: tA, body: { sealed: envelope } });
    assert.equal(r.status, 200, r.text); assert.equal(r.body.request.status, 'code_submitted');
  });
  await check('the backend refuses a plaintext code (sealed-only mode)', async () => {
    const r = await api('POST', `/requests/${requestId}/submit-code`, { token: tA, body: { code: 'PLAINTEXT-CODE-1', pin: '1' } });
    assert.equal(r.status, 400, r.text); assert.equal(r.body.error, 'sealed_required');
  });

  console.log('\n== 7. What is on-chain and in the database ==');
  await chainCheck('on-chain record: hash, delivery time (= block time), Saad as sender, Shivam as recipient', async () => {
    const [f, rec, at, kid, h] = await pub.readContract({ address: MAILBOX, abi: mailboxAbi, functionName: 'deliveries', args: [escrowId] });
    const block = await pub.getBlock({ blockNumber: deliverReceipt.blockNumber });
    assert.equal(f, saad.address); assert.equal(rec, shivam.address); assert.equal(at, block.timestamp);
    assert.equal(kid, `0x${V.keyId(keys.publicKeyHex)}`); assert.equal(h, keccak256(ciphertextHex));
    assert.ok(await pub.readContract({ address: MAILBOX, abi: mailboxAbi, functionName: 'matches', args: [escrowId, ciphertextHex] }));
  });
  let onChainEnvelope;
  await chainCheck('Shivam finds the Delivered event through the RPC and decrypts it locally: the code arrives', async () => {
    const logs = await pub.getLogs({ address: MAILBOX, event: deliveredEvent, args: { escrowId }, fromBlock: deliverReceipt.blockNumber, toBlock: deliverReceipt.blockNumber });
    assert.equal(logs.length, 1);
    assert.ok(!hexToString(logs[0].args.ciphertext).includes(CODE.code), 'plaintext code is visible in the public event');
    onChainEnvelope = JSON.parse(hexToString(logs[0].args.ciphertext));
    assert.deepEqual(V.open(onChainEnvelope, keys.privateKey, V.voucherAad(requestId, shivam.address, saad.address)), CODE);
  });
  await check('Shivam also fetches it from the backend; the same code comes out; Saad and outsiders cannot fetch it', async () => {
    const v = await api('GET', `/requests/${requestId}/voucher`, { token: tS });
    assert.equal(v.status, 200, v.text); assert.ok(!v.text.includes(CODE.code));
    assert.deepEqual(V.open(v.body.voucher.sealed, keys.privateKey, V.voucherAad(requestId, v.body.voucher.requester, v.body.voucher.fulfiller)), CODE);
    assert.equal((await api('GET', `/requests/${requestId}/voucher`, { token: tA })).status, 403);
    assert.equal((await api('GET', `/requests/${requestId}/voucher`)).status, 401);
  });
  await check('the offline dispute key can also open the box; Saad\'s own key cannot (he is not a recipient)', async () => {
    const env = onChainEnvelope ?? envelope;
    assert.deepEqual(V.open(env, adminKeys.privateKey, V.voucherAad(requestId, shivam.address, saad.address)), CODE);
    const saadKeys = V.deriveVaultKeys(await saad.signMessage({ message: V.KEY_MESSAGE }));
    assert.throws(() => V.open(env, saadKeys.privateKey, V.voucherAad(requestId, shivam.address, saad.address)));
  });
  await check('DATABASE: the code and PIN exist nowhere in the stored request, voucher or event documents', async () => {
    const docs = [(await col.requests.doc(requestId).get()).data(), (await voucherRef(requestId).get()).data(), ...(await eventsRef(requestId).get()).docs.map((d) => d.data())];
    const blob = JSON.stringify(docs);
    assert.ok(!blob.includes(CODE.code) && !blob.includes(`"${CODE.pin}"`), 'plaintext found in the database');
    assert.ok((await voucherRef(requestId).get()).data().sealed, 'stored as a sealed envelope');
  });

  console.log('\n== 8. Shivam confirms -> the backend operator releases the USDC to Saad (REAL) ==');
  let saadBefore = 0n;
  if (REAL_CHAIN) saadBefore = await bal(saad.address);
  await check('POST /requests/:id/confirm -> released', async () => {
    const c = await api('POST', `/requests/${requestId}/confirm`, { token: tS });
    assert.equal(c.status, 200, c.text); assert.equal(c.body.request.status, 'released'); assert.ok(c.body.request.releaseTxHash);
  });
  await chainCheck('on-chain: escrow is Released and Saad received exactly 0.10 USDC (fee is 0)', async () => {
    const [, , status] = await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'escrows', args: [escrowId] });
    assert.equal(status, 2);
    assert.equal((await bal(saad.address)) - saadBefore, AMOUNT_BASE);
  });
  await check('the code is still retrievable by Shivam after release (his vault keeps it)', async () => {
    const it = (await api('GET', '/vault', { token: tS })).body.items.find((x) => x.requestId === requestId);
    assert.ok(it && it.sealed && it.status === 'released');
    assert.deepEqual(V.open(it.sealed, keys.privateKey, V.voucherAad(requestId, it.requester, it.fulfiller)), CODE);
  });

  console.log('\n== 9. A second request that is cancelled: deposit -> refund (REAL) ==');
  let id3;
  await check('create, deposit and fund a second request', async () => {
    const r = await api('POST', '/requests', { token: tS, body: { brand: 'swiggy', amountInr: 9, amountUsdc: '0.10' } });
    assert.equal(r.status, 201, r.text); id3 = r.body.request.id; created.requests.push(id3); saveManifest();
    let h = `0x${crypto.randomBytes(32).toString('hex')}`;
    if (REAL_CHAIN) {
      await sendTx(shivam, 'USDC.approve', { address: USDC, abi: erc20, functionName: 'approve', args: [ESCROW, AMOUNT_BASE] });
      h = (await sendTx(shivam, 'Escrow.deposit (2nd)', { address: ESCROW, abi: ESCROW_ABI, functionName: 'deposit', args: [keccak256(stringToHex(id3)), AMOUNT_BASE] })).transactionHash;
    }
    const f = await api('POST', `/requests/${id3}/fund`, { token: tS, body: { txHash: h } });
    assert.equal(f.status, 200, f.text);
  });
  await check('cancel the unaccepted request -> the backend refunds on-chain', async () => {
    const c = await api('POST', `/requests/${id3}/cancel`, { token: tS });
    assert.equal(c.status, 200, c.text); assert.match(c.body.request.status, /refunded|cancelled/);
    if (REAL_CHAIN) assert.equal((await pub.readContract({ address: ESCROW, abi: ESCROW_ABI, functionName: 'escrows', args: [keccak256(stringToHex(id3))] }))[2], 3);
  });

  console.log('\n== 10. Tidy up and read back ==');
  await chainCheck('Saad returns the USDC and leftover gas money to Shivam (best effort)', async () => {
    const b = await pub.getBalance({ address: saad.address });
    const keep = 4_000_000_000_000_000n;
    if (b > keep * 2n) { const hash = await wc(saad).sendTransaction({ to: shivam.address, value: b - keep }); await pub.waitForTransactionReceipt({ hash }); }
  });
  await check('list endpoints work against this database (needs the composite indexes on a real Firestore)', async () => {
    const mine = await api('GET', '/requests/mine', { token: tS });
    assert.equal(mine.status, 200, mine.text); assert.ok(mine.body.asRequester.length >= 2);
    assert.equal((await api('GET', '/requests?brand=amazon')).status, 200);
    assert.equal((await api('GET', '/vault', { token: tS })).status, 200);
  });
} finally {
  backend.close();
  bot.kill();
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

if (REAL_CHAIN) {
  console.log(`\nTransactions:\n${txs.map((t) => `  ${t.label.padEnd(26)} ${t.hash}${t.gas ? `  gas ${t.gas}` : ''}`).join('\n')}`);
  const endNative = await pub.getBalance({ address: shivam.address });
  console.log(`\nShivam/operator balance: ${formatUnits(startNative, 18)} -> ${formatUnits(endNative, 18)} USDC (net cost ${formatUnits(startNative - endNative, 18)})`);
}
if (REAL_DB && requestId) {
  console.log('\nWhere to look in the Firebase console:');
  console.log(`  request (released): ${consoleUrl(`requests/${requestId}`)}`);
  console.log(`  all requests      : ${consoleUrl('requests')}`);
  console.log(`  users             : ${consoleUrl('users')}`);
  console.log(`\nManifest of everything created (use --cleanup to delete exactly these): ${MANIFEST}`);
}
const failed = results.filter((r) => !r).length;
console.log(`\n==== ${results.length - failed}/${results.length} checks passed${skipped.length ? `, ${skipped.length} skipped (dry run)` : ''} ====`);
process.exitCode = failed ? 1 : 0;
setTimeout(() => process.exit(), 300);
