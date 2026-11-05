// Integration simulation: Python chatbot API  <->  Node backend (mock escrow, in-memory Firestore stand-in).
//
//   cd backend && node --import ./test-support/register.mjs scripts/integration-sim.js
//
// Scope: seller query -> merchant choice -> request draft -> POST /requests -> "deposit" -> POST /requests/:id/fund -> open + listed.
// Then (bonus) the buyer side: chatbot ranking -> accept -> submit code -> confirm -> released.
//
// SAFETY: uses throwaway secrets generated at start-up. It never reads backend/.env and refuses real Firebase credentials
// (see test-support/register.mjs). ESCROW_MODE=mock: NO real funds move and no chain is contacted.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, stringToHex } from 'viem';

const here = path.dirname(fileURLToPath(import.meta.url));
const chatbotDir = path.resolve(here, '../../chatbot');

const JWT_SECRET = crypto.randomBytes(48).toString('hex');
const ENC_KEY = crypto.randomBytes(32).toString('hex');
for (const k of ['FIREBASE_SERVICE_ACCOUNT_JSON', 'GOOGLE_APPLICATION_CREDENTIALS', 'ESCROW_OPERATOR_PRIVATE_KEY']) delete process.env[k];
Object.assign(process.env, {
  NODE_ENV: 'test',
  JWT_SECRET,
  VOUCHER_ENC_KEY: ENC_KEY,
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_MOCK: 'true',
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
  CORS_ORIGINS: 'http://localhost:3000',
  FULFIL_WINDOW_MINUTES: '30',
  REVIEW_WINDOW_MINUTES: '60',
});

const { createApp } = await import('../src/app.js');
const { BRANDS } = await import('../src/config.js');
const { __dump } = await import('../test-support/fake-firestore.mjs');

// ---------- tiny harness ----------
const results = [];
const findings = [];
let section = '';
const head = (s) => { section = s; console.log(`\n== ${s} ==`); };
async function check(name, fn) {
  try {
    await fn();
    results.push({ section, name, ok: true });
    console.log(`  PASS  ${name}`);
  } catch (e) {
    results.push({ section, name, ok: false, err: e.message.split('\n')[0] });
    console.log(`  FAIL  ${name}\n        ${e.message.split('\n')[0]}`);
  }
}
const finding = (text) => { findings.push(text); console.log(`  NOTE  ${text}`); };

// ---------- servers ----------
const backend = createApp().listen(0);
const BACKEND = `http://127.0.0.1:${backend.address().port}`;

const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const botPort = await freePort();
const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'np-sim-')), 'portfolios.json');
const bot = spawn('python', ['server.py'], {
  cwd: chatbotDir,
  env: { ...process.env, PORT: String(botPort), NETPOSITIVE_STATE_FILE: stateFile, PYTHONIOENCODING: 'utf-8' },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const CHATBOT = `http://127.0.0.1:${botPort}`;
let botUp = false;
for (let i = 0; i < 60 && !botUp; i++) {
  try { botUp = (await fetch(`${CHATBOT}/health`)).ok; } catch { await new Promise((r) => setTimeout(r, 250)); }
}

async function http(base, method, p, { token, body, headers = {}, raw } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }), ...headers },
    body: raw ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json, headers: res.headers, text };
}
const api = (m, p, o) => http(BACKEND, m, p, o);
const chat = (m, p, o) => http(CHATBOT, m, p, o);

async function signIn(account) {
  const { body } = await api('POST', '/auth/nonce', { body: { address: account.address } });
  const signature = await account.signMessage({ message: body.message });
  const r = await api('POST', '/auth/verify', { body: { address: account.address, signature } });
  assert.equal(r.status, 200);
  return r.body.token;
}
const proof = (n) => ({ proof: '0x01', merkle_root: '0x02', nullifier_hash: `0x${n.toString(16).padStart(64, '0')}`, verification_level: 'orb' });
const fakeDepositTx = () => `0x${crypto.randomBytes(32).toString('hex')}`;

// Adapter: chatbot draft -> backend create payload. The rate (INR per USDC) is agreed between the two users in the order book.
const RATE_INR_PER_USDC = 90;
const toBackendPayload = (draft, rate = RATE_INR_PER_USDC) => ({
  brand: draft.request.merchant_id,
  amountInr: draft.request.amount_inr,
  amountUsdc: (draft.request.amount_inr / rate).toFixed(2),
});

let alice, bob, carol, ta, tb, tc, draft, payload, requestId;

try {
  // =====================================================================
  head('0. Environment safety');
  await check('simulation runs on throwaway secrets, mock escrow, mock World ID', async () => {
    const h = await api('GET', '/health');
    assert.deepEqual([h.body.escrowMode, h.body.worldIdMock], ['mock', true]);
  });
  await check('no real Firebase credentials in this process', () => {
    assert.ok(!process.env.FIREBASE_SERVICE_ACCOUNT_JSON && !process.env.GOOGLE_APPLICATION_CREDENTIALS);
  });
  await check('chatbot API is up', async () => { assert.ok(botUp, 'chatbot server did not start'); });

  // =====================================================================
  head('1. Identity (wallet sign-in + World ID)');
  alice = privateKeyToAccount(generatePrivateKey()); // seller of crypto = requester
  bob = privateKeyToAccount(generatePrivateKey()); // buyer of crypto = fulfiller
  carol = privateKeyToAccount(generatePrivateKey()); // signed in, NOT World-ID verified
  [ta, tb, tc] = await Promise.all([signIn(alice), signIn(bob), signIn(carol)]);
  const n0 = Date.now();
  await check('seller and buyer verify World ID (mock)', async () => {
    assert.equal((await api('POST', '/world-id/verify', { token: ta, body: proof(n0) })).status, 200);
    assert.equal((await api('POST', '/world-id/verify', { token: tb, body: proof(n0 + 1) })).status, 200);
  });
  await check('unverified human cannot create a request (403 world_id_required)', async () => {
    const r = await api('POST', '/requests', { token: tc, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11.11' } });
    assert.equal(r.status, 403);
    assert.equal(r.body.error, 'world_id_required');
  });

  // =====================================================================
  head('2. Seller talks to the chatbot (merchant choice -> request draft)');
  await check('"shoes" -> ranked merchant tiles', async () => {
    const r = await chat('POST', '/merchants/suggest', { body: { query: 'shoes' } });
    assert.equal(r.body.mode, 'tiles');
    assert.deepEqual(r.body.tiles.map((t) => t.name).slice(0, 2), ['Amazon', 'Flipkart']);
  });
  await check('"nike shoes from amazon" -> Amazon locked', async () => {
    const r = await chat('POST', '/merchants/suggest', { body: { query: 'nike shoes from amazon' } });
    assert.equal(r.body.mode, 'store_locked');
    assert.equal(r.body.selected.merchant_id, 'amazon');
  });
  await check('draft request for Amazon, INR 10,000', async () => {
    draft = (await chat('POST', '/request/draft', { body: { merchant: 'amazon', amount: 10000, item: 'Nike shoes' } })).body;
    assert.equal(draft.ok, true);
    assert.equal(draft.request.voucher_brand, 'Amazon');
    assert.deepEqual(draft.request.suggested_split, [5000, 5000]);
    payload = toBackendPayload(draft);
    assert.deepEqual(payload, { brand: 'amazon', amountInr: 10000, amountUsdc: '111.11' }); // matches the walkthrough: Rs10,000 @ Rs90 = 111.11
  });

  // =====================================================================
  head('3. POST /requests (create) and escrow deposit (mock)');
  await check('unauthenticated create is rejected (401)', async () => {
    assert.equal((await api('POST', '/requests', { body: payload })).status, 401);
  });
  await check('POST /requests -> 201, pending_funding, correct amounts', async () => {
    const r = await api('POST', '/requests', { token: ta, body: payload });
    assert.equal(r.status, 201, r.text);
    const q = r.body.request;
    requestId = q.id;
    assert.equal(q.status, 'pending_funding');
    assert.equal(q.requester, alice.address.toLowerCase());
    assert.equal(q.fulfiller, null);
    assert.equal(q.brand, 'amazon');
    assert.equal(q.amountInr, 10000);
    assert.equal(q.amountUsdc, '111.11');
    assert.equal(q.amountUsdcBaseUnits, '111110000'); // 6 decimals
  });
  await check('escrowId = keccak256(requestId), as the frontend/contract expect', async () => {
    const q = (await api('GET', `/requests/${requestId}`)).body.request;
    assert.equal(q.escrowId, keccak256(stringToHex(requestId)));
  });
  await check('request is NOT visible to buyers before it is funded', async () => {
    const r = await api('GET', '/requests?brand=amazon');
    assert.ok(!r.body.requests.some((x) => x.id === requestId));
  });
  await check('a buyer cannot accept an unfunded request (409)', async () => {
    assert.equal((await api('POST', `/requests/${requestId}/accept`, { token: tb })).status, 409);
  });
  await check('only the requester can fund (403 for others)', async () => {
    assert.equal((await api('POST', `/requests/${requestId}/fund`, { token: tb, body: { txHash: fakeDepositTx() } })).status, 403);
  });
  await check('a malformed tx hash is rejected (400)', async () => {
    assert.equal((await api('POST', `/requests/${requestId}/fund`, { token: ta, body: { txHash: '0x123' } })).status, 400);
  });
  let depositTx;
  await check('simulated deposit: POST /requests/:id/fund -> status open', async () => {
    depositTx = fakeDepositTx();
    const r = await api('POST', `/requests/${requestId}/fund`, { token: ta, body: { txHash: depositTx } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.request.status, 'open');
    assert.equal(r.body.request.escrowTxHash, depositTx);
  });
  await check('funding twice is rejected (409), so a deposit is never counted twice', async () => {
    assert.equal((await api('POST', `/requests/${requestId}/fund`, { token: ta, body: { txHash: fakeDepositTx() } })).status, 409);
  });
  await check('request now listed as open (all, by brand) and in "mine"', async () => {
    const all = await api('GET', '/requests');
    const amz = await api('GET', '/requests?brand=amazon');
    const other = await api('GET', '/requests?brand=zomato');
    assert.ok(all.body.requests.some((x) => x.id === requestId));
    assert.ok(amz.body.requests.some((x) => x.id === requestId));
    assert.ok(!other.body.requests.some((x) => x.id === requestId));
    const mine = await api('GET', '/requests/mine', { token: ta });
    assert.ok(mine.body.asRequester.some((x) => x.id === requestId));
  });
  await check('audit trail has created -> funded, both by the requester', async () => {
    const d = __dump();
    const ev = Object.entries(d).filter(([p]) => p.startsWith(`requests/${requestId}/events/`)).map(([, v]) => v);
    assert.deepEqual(ev.map((e) => e.type).sort(), ['created', 'funded']);
    assert.ok(ev.every((e) => e.actor === alice.address.toLowerCase()));
  });
  finding('ESCROW_MODE=mock: the "deposit" is a simulated tx hash. NO funds moved and the chain was never contacted. A real-escrow test needs a deployed contract address + operator key (both empty in the env you shared) and funded testnet wallets.');
  finding('Backend escrow is USDC (6 decimals), not ETH. The seller locks USDC; if ETH is intended the contract/token model must change.');

  // =====================================================================
  head('4. Validation and abuse cases on POST /requests');
  const bad = (name, body, expectStatus = 400) => check(name, async () => {
    const r = await api('POST', '/requests', { token: ta, body });
    assert.equal(r.status, expectStatus, r.text);
    if (expectStatus === 400) assert.equal(r.body.error, 'validation_error');
  });
  await bad('unsupported brand "ajio" -> 400', { brand: 'ajio', amountInr: 1000, amountUsdc: '11.11' });
  await bad('fractional INR -> 400', { brand: 'amazon', amountInr: 10000.5, amountUsdc: '111.11' });
  await bad('INR above the 100,000 cap -> 400', { brand: 'amazon', amountInr: 100001, amountUsdc: '1111.12' });
  await bad('negative INR -> 400', { brand: 'amazon', amountInr: -5, amountUsdc: '1' });
  await bad('USDC with 7 decimals -> 400', { brand: 'amazon', amountInr: 1000, amountUsdc: '1.1234567' });
  await bad('USDC not a number -> 400', { brand: 'amazon', amountInr: 1000, amountUsdc: 'abc' });
  await bad('USDC as a JSON number (float risk) -> 400', { brand: 'amazon', amountInr: 1000, amountUsdc: 11.11 });
  await bad('missing fields -> 400', {});
  await check('zero USDC amount is rejected', async () => {
    const r = await api('POST', '/requests', { token: ta, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '0' } });
    assert.equal(r.status, 400);
  });
  await check('malformed JSON -> 400 invalid_json, no stack trace', async () => {
    const r = await api('POST', '/requests', { token: ta, raw: '{"brand":' });
    assert.equal(r.status, 400);
    assert.equal(r.body.error, 'invalid_json');
    assert.ok(!/at .*\.js/.test(r.text));
  });
  await check('oversized body (>32kb) is rejected (413)', async () => {
    const r = await api('POST', '/requests', { token: ta, raw: JSON.stringify({ brand: 'amazon', pad: 'x'.repeat(40000) }) });
    assert.equal(r.status, 413);
  });
  await check('tampered / wrong-secret token -> 401', async () => {
    const r = await api('POST', '/requests', { token: ta.slice(0, -3) + 'abc', body: payload });
    assert.equal(r.status, 401);
  });
  await check('unknown request id -> 404; unknown route -> 404', async () => {
    assert.equal((await api('GET', '/requests/does-not-exist')).status, 404);
    assert.equal((await api('GET', '/nope')).status, 404);
  });
  await check('non-requester cannot cancel (403)', async () => {
    assert.equal((await api('POST', `/requests/${requestId}/cancel`, { token: tb })).status, 403);
  });
  await check('CORS: frontend origin allowed, other origins not', async () => {
    const ok = await api('GET', '/health', { headers: { origin: 'http://localhost:3000' } });
    const no = await api('GET', '/health', { headers: { origin: 'https://evil.example' } });
    assert.equal(ok.headers.get('access-control-allow-origin'), 'http://localhost:3000');
    assert.equal(no.headers.get('access-control-allow-origin'), null);
  });

  // =====================================================================
  head('5. Chatbot <-> backend contract (can every seller choice become a request?)');
  const queries = ['shoes', 'nike shoes', 'clothes', 'electronics', 'makeup', 'groceries', 'food', 'movies', 'jewellery', 'hotel', 'iphone', 'books'];
  const tiles = new Map();
  for (const q of queries) {
    const r = await chat('POST', '/merchants/suggest', { body: { query: q } });
    for (const t of r.body.tiles ?? []) tiles.set(t.merchant_id, t.name);
  }
  const supported = [...tiles.keys()].filter((id) => BRANDS.includes(id));
  const unsupported = [...tiles.keys()].filter((id) => !BRANDS.includes(id));
  await check(`every supported chatbot merchant (${supported.join(', ')}) can be drafted and created`, async () => {
    for (const id of supported) {
      const d = (await chat('POST', '/request/draft', { body: { merchant: id, amount: 500 } })).body;
      const r = await api('POST', '/requests', { token: ta, body: toBackendPayload(d) });
      assert.equal(r.status, 201, `${id}: ${r.text}`);
    }
  });
  await check(`unsupported merchants (${unsupported.join(', ')}) fail cleanly with 400, never 500`, async () => {
    for (const id of unsupported) {
      const d = (await chat('POST', '/request/draft', { body: { merchant: id, amount: 500 } })).body;
      const r = await api('POST', '/requests', { token: ta, body: toBackendPayload(d) });
      assert.equal(r.status, 400, `${id}: ${r.status}`);
    }
  });
  if (unsupported.length) finding(`INTEGRATION GAP: the chatbot offers merchants the backend rejects: ${unsupported.map((i) => tiles.get(i)).join(', ')}. The seller could pick one and then fail at POST /requests. Fix: share one brand list (or have the chatbot filter its tiles to the backend's BRANDS).`);
  const backendOnly = BRANDS.filter((b) => !tiles.has(b));
  if (backendOnly.length) finding(`Backend supports brands the chatbot never suggests: ${backendOnly.join(', ')}.`);
  await check('chatbot allows INR > 100,000 but the backend caps it (the seller gets a clear 400)', async () => {
    const d = (await chat('POST', '/request/draft', { body: { merchant: 'amazon', amount: 150000 } })).body;
    assert.equal(d.ok, true);
    const r = await api('POST', '/requests', { token: ta, body: toBackendPayload(d) });
    assert.equal(r.status, 400);
  });
  finding('INTEGRATION GAP: the chatbot has no INR<->USDC rate or fee logic (walkthrough: 1% fee, user-set rate). This simulation used a fixed Rs 90/USDC adapter. The backend locks amountUsdc exactly and pays all of it to the fulfiller, so the 1% fee is not implemented anywhere yet.');
  finding('INTEGRATION GAP: amountInr must be an integer <= 100,000 in the backend, while the chatbot accepts any positive number up to Rs 10 crore.');

  // =====================================================================
  head('6. Bonus: buyer side (chatbot ranking -> accept -> submit code -> confirm)');
  const bobId = bob.address.toLowerCase();
  await check('buyer adds a card using their wallet address as chatbot user_id', async () => {
    const r = await chat('POST', '/portfolio/add', { body: { user_id: bobId, card: 'HDFC Infinia' } });
    assert.equal(r.body.ok, true);
  });
  await check('chatbot ranking for the accepted request: best first, brand/amount match the request', async () => {
    const q = (await api('GET', `/requests/${requestId}`)).body.request;
    const r = (await chat('POST', '/request/fulfil', { body: { user_id: bobId, brand: q.brand, amount: q.amountInr } })).body;
    assert.equal(r.options[0].best, true);
    assert.equal(r.options[0].card, 'HDFC Infinia');
    assert.equal(r.must_match.total_amount_inr, q.amountInr);
    assert.ok(r.options[0].link.startsWith('https://'));
  });
  await check('seller cannot accept their own request (403)', async () => {
    assert.equal((await api('POST', `/requests/${requestId}/accept`, { token: ta })).status, 403);
  });
  await check('buyer accepts -> accepted, no longer in the open list', async () => {
    const r = await api('POST', `/requests/${requestId}/accept`, { token: tb });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.request.status, 'accepted');
    assert.equal(r.body.request.fulfiller, bobId);
    assert.ok(!(await api('GET', '/requests?brand=amazon')).body.requests.some((x) => x.id === requestId));
  });
  const SECRET_CODE = 'AMZN-SIM-' + crypto.randomBytes(4).toString('hex').toUpperCase();
  await check('buyer submits the voucher code -> code_submitted', async () => {
    const r = await api('POST', `/requests/${requestId}/submit-code`, { token: tb, body: { code: SECRET_CODE, pin: '4321' } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.request.status, 'code_submitted');
  });
  await check('code is never exposed publicly and is encrypted at rest', async () => {
    const pub = await api('GET', `/requests/${requestId}`);
    assert.ok(!pub.text.includes(SECRET_CODE));
    const stored = JSON.stringify(Object.entries(__dump()).filter(([p]) => p.endsWith('/private/voucher')));
    assert.ok(!stored.includes(SECRET_CODE), 'plaintext code found in stored voucher doc');
    assert.equal((await api('GET', `/requests/${requestId}/voucher`, { token: tb })).status, 403);
  });
  await check('seller reads the code, confirms -> released exactly once', async () => {
    const v = await api('GET', `/requests/${requestId}/voucher`, { token: ta });
    assert.equal(v.body.voucher.code, SECRET_CODE);
    const [c1, c2] = await Promise.all([
      api('POST', `/requests/${requestId}/confirm`, { token: ta }),
      api('POST', `/requests/${requestId}/confirm`, { token: ta }),
    ]);
    assert.deepEqual([c1.status, c2.status].sort(), [200, 409]);
    const q = (await api('GET', `/requests/${requestId}`)).body.request;
    assert.equal(q.status, 'released');
    assert.ok(q.releaseTxHash);
  });

  // =====================================================================
  head('7. Secret hygiene');
  await check('no secret, key or private-key marker appears in any response so far', async () => {
    const probes = [`/requests/${requestId}`, '/requests', '/health', '/world-id/config'];
    for (const p of probes) {
      const t = (await api('GET', p)).text;
      for (const s of [JWT_SECRET, ENC_KEY, 'PRIVATE KEY', 'private_key', 'sk-or-v1']) assert.ok(!t.includes(s), `${p} leaked ${s.slice(0, 6)}...`);
    }
    const mine = (await api('GET', '/auth/me', { token: ta })).text;
    assert.ok(!mine.includes(JWT_SECRET) && !mine.includes(ENC_KEY));
  });
} finally {
  backend.close();
  bot.kill();
  try { fs.rmSync(path.dirname(stateFile), { recursive: true, force: true }); } catch { /* ignore */ }
}

// ---------- report ----------
const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (failed.length) {
  console.log('FAILED:');
  for (const f of failed) console.log(`  - [${f.section}] ${f.name}: ${f.err}`);
}
console.log(`\nFindings (${findings.length}):`);
findings.forEach((f, i) => console.log(`  ${i + 1}. ${f}`));
process.exitCode = failed.length ? 1 : 0;
setTimeout(() => process.exit(), 300);
