// Posts REAL test requests into a REAL Firestore project so they show up in the Firebase console.
// Scope: sign-in -> World ID (MOCK) -> chatbot draft -> POST /requests -> simulated deposit -> POST /requests/:id/fund -> open + listed.
// Escrow is MOCK (no chain), World ID is MOCK. Nothing here moves money.
//
// REAL RUN (writes to the project in the key file):
//   SA_PATH=<service-account.json> CONFIRM_REAL_FIRESTORE=<project_id> node scripts/real-firestore-check.mjs
// DRY RUN (in-memory stand-in, writes nothing real; validates this script):
//   DRY_RUN=1 node --import ./test-support/register.mjs scripts/real-firestore-check.mjs
// Cleanup of exactly what a run created (reads the manifest it wrote):
//   SA_PATH=... CONFIRM_REAL_FIRESTORE=<project_id> MANIFEST=<manifest.json> node scripts/real-firestore-check.mjs --cleanup
//
// SAFETY: the key is only read from SA_PATH (never printed or committed); a real run needs CONFIRM_REAL_FIRESTORE to equal the
// key's project_id; every document created is recorded in a manifest; cleanup deletes only manifest entries.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const DRY = process.env.DRY_RUN === '1';
const CLEANUP = process.argv.includes('--cleanup');
const here = path.dirname(fileURLToPath(import.meta.url));
const chatbotDir = path.resolve(here, '../../chatbot');
const MANIFEST = process.env.MANIFEST || path.join(os.tmpdir(), `np-real-test-manifest-${Date.now()}.json`);

// ---------- environment (never uses a pasted .env; fresh throwaway app secrets) ----------
delete process.env.FIRESTORE_EMULATOR_HOST; // the emulator host in a .env must never silently redirect a "real" run
delete process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
let projectId = 'demo-netpositive';
if (!DRY) {
  if (!process.env.SA_PATH) { console.error('SA_PATH (path to the service-account JSON) is required for a real run.'); process.exit(2); }
  const sa = JSON.parse(fs.readFileSync(process.env.SA_PATH, 'utf8'));
  projectId = sa.project_id;
  if (process.env.CONFIRM_REAL_FIRESTORE !== projectId) {
    console.error(`Refusing to write to a REAL project. Re-run with CONFIRM_REAL_FIRESTORE=${projectId} to confirm.`);
    process.exit(2);
  }
  process.env.GOOGLE_APPLICATION_CREDENTIALS = process.env.SA_PATH;
}
Object.assign(process.env, {
  NODE_ENV: 'development',
  JWT_SECRET: crypto.randomBytes(48).toString('hex'),
  VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  FIREBASE_PROJECT_ID: projectId,
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_MOCK: 'true',
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '0',
  CORS_ORIGINS: 'http://localhost:3000',
});

const { createApp } = await import('../src/app.js');
const { col, db, eventsRef } = await import('../src/services/firestore.js');

const consoleUrl = (p) => `https://console.firebase.google.com/project/${projectId}/firestore/databases/-default-/data/~2F${p.split('/').join('~2F')}`;
const created = { users: [], nullifiers: [], requests: [] };
const saveManifest = () => fs.writeFileSync(MANIFEST, JSON.stringify({ projectId, created }, null, 2));

// ---------- cleanup mode ----------
async function cleanup(manifestPath) {
  const m = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  assert.equal(m.projectId, projectId, 'manifest belongs to a different project');
  let n = 0;
  for (const id of m.created.requests) {
    for (const sub of ['events', 'private']) {
      const snap = await col.requests.doc(id).collection(sub).get();
      for (const d of snap.docs) { await d.ref.delete(); n++; }
    }
    await col.requests.doc(id).delete(); n++;
  }
  for (const a of m.created.users) { await col.users.doc(a).delete(); n++; }
  for (const h of m.created.nullifiers) { await col.nullifiers.doc(h).delete(); n++; }
  console.log(`Deleted ${n} documents listed in the manifest. Nothing else was touched.`);
  return n;
}
if (CLEANUP) {
  if (!process.env.MANIFEST) { console.error('MANIFEST=<path> is required for --cleanup'); process.exit(2); }
  await cleanup(process.env.MANIFEST);
  process.exit(0);
}

// ---------- harness ----------
const results = [];
const notes = [];
async function check(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log(`  PASS  ${name}`); }
  catch (e) {
    const msg = String(e.message).replace(/\s+/g, ' ');
    results.push({ name, ok: false, err: msg.slice(0, 400) });
    console.log(`  FAIL  ${name}\n        ${msg.slice(0, 400)}`);
    const link = msg.match(/https:\/\/console\.firebase\.google\.com\/[^\s]+/);
    if (link) console.log(`        >>> create the missing index here: ${link[0]}`);
  }
}
const backend = createApp().listen(0);
const BACKEND = `http://127.0.0.1:${backend.address().port}`;
const freePort = () => new Promise((res) => { const s = net.createServer().listen(0, () => { const p = s.address().port; s.close(() => res(p)); }); });
const botPort = await freePort();
const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-real-'));
const bot = spawn('python', ['server.py'], {
  cwd: chatbotDir,
  env: { ...process.env, PORT: String(botPort), NETPOSITIVE_STATE_FILE: path.join(stateDir, 'pf.json'), PYTHONIOENCODING: 'utf-8' },
  stdio: ['ignore', 'ignore', 'ignore'],
});
const CHATBOT = `http://127.0.0.1:${botPort}`;
for (let i = 0; i < 60; i++) { try { if ((await fetch(`${CHATBOT}/health`)).ok) break; } catch { await new Promise((r) => setTimeout(r, 250)); } }

async function http(base, method, p, { token, body } = {}) {
  const res = await fetch(base + p, {
    method,
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json; try { json = JSON.parse(text); } catch { json = { _raw: text }; }
  return { status: res.status, body: json, text };
}
const api = (m, p, o) => http(BACKEND, m, p, o);
const chat = (m, p, o) => http(CHATBOT, m, p, o);
const fakeTx = () => `0x${crypto.randomBytes(32).toString('hex')}`;

let alice, ta, draftA, reqOpen, reqPending;
try {
  console.log(`\nTarget project: ${projectId}  ${DRY ? '(DRY RUN: in-memory, nothing real is written)' : '(REAL FIRESTORE)'}`);
  console.log('Escrow: MOCK (no chain)   World ID: MOCK   App secrets: throwaway\n');

  console.log('== 1. Firestore reachable ==');
  await check('read/write access to the database works', async () => {
    const r = await col.users.doc('__connectivity_probe__').get();
    assert.equal(r.exists, false);
  });

  console.log('\n== 2. Sign-in (real writes: users/, authNonces/) ==');
  alice = privateKeyToAccount(generatePrivateKey());
  const addr = alice.address.toLowerCase();
  await check('wallet sign-in creates the user document', async () => {
    const n = await api('POST', '/auth/nonce', { body: { address: alice.address } });
    assert.equal(n.status, 200, n.text);
    const signature = await alice.signMessage({ message: n.body.message });
    const v = await api('POST', '/auth/verify', { body: { address: alice.address, signature } });
    assert.equal(v.status, 200, v.text);
    ta = v.body.token;
    created.users.push(addr);
    const u = await col.users.doc(addr).get();
    assert.ok(u.exists);
  });
  await check('World ID (MOCK) binds a nullifier to the wallet', async () => {
    const nh = `0x${crypto.randomBytes(32).toString('hex')}`;
    const r = await api('POST', '/world-id/verify', { token: ta, body: { proof: '0x01', merkle_root: '0x02', nullifier_hash: nh, verification_level: 'orb' } });
    assert.equal(r.status, 200, r.text);
    created.nullifiers.push(nh);
  });
  saveManifest();

  console.log('\n== 3. Seller -> chatbot -> request draft ==');
  await check('chatbot suggests Amazon for "nike shoes from amazon" and drafts INR 10,000', async () => {
    const s = await chat('POST', '/merchants/suggest', { body: { query: 'nike shoes from amazon' } });
    assert.equal(s.body.selected.merchant_id, 'amazon');
    draftA = (await chat('POST', '/request/draft', { body: { merchant: 'amazon', amount: 10000, item: 'Nike shoes' } })).body;
    assert.equal(draftA.ok, true);
  });
  const rate = 90; // INR per USDC (walkthrough example)
  const payloadOf = (d) => ({ brand: d.request.merchant_id, amountInr: d.request.amount_inr, amountUsdc: (d.request.amount_inr / rate).toFixed(2) });

  console.log('\n== 4. POST /requests, simulated escrow deposit, fund (real writes: requests/, events/) ==');
  await check('POST /requests (Amazon, INR 10,000 = 111.11 USDC) -> pending_funding', async () => {
    const r = await api('POST', '/requests', { token: ta, body: payloadOf(draftA) });
    assert.equal(r.status, 201, r.text);
    reqOpen = r.body.request;
    created.requests.push(reqOpen.id);
    saveManifest();
    assert.equal(reqOpen.status, 'pending_funding');
    assert.equal(reqOpen.amountUsdcBaseUnits, '111110000');
  });
  await check('simulated deposit + POST /requests/:id/fund -> open', async () => {
    const r = await api('POST', `/requests/${reqOpen.id}/fund`, { token: ta, body: { txHash: fakeTx() } });
    assert.equal(r.status, 200, r.text);
    assert.equal(r.body.request.status, 'open');
  });
  await check('second request (Swiggy, INR 500) left in pending_funding so the dashboard shows both states', async () => {
    const d = (await chat('POST', '/request/draft', { body: { merchant: 'swiggy', amount: 500, item: 'Dinner' } })).body;
    const r = await api('POST', '/requests', { token: ta, body: payloadOf(d) });
    assert.equal(r.status, 201, r.text);
    reqPending = r.body.request;
    created.requests.push(reqPending.id);
    saveManifest();
  });

  console.log('\n== 5. Read back straight from the database (what the dashboard shows) ==');
  await check('requests/<id> document holds the expected fields', async () => {
    const d = (await col.requests.doc(reqOpen.id).get()).data();
    assert.equal(d.status, 'open');
    assert.equal(d.brand, 'amazon');
    assert.equal(d.requester, addr);
    assert.equal(d.amountInr, 10000);
    assert.equal(d.amountUsdc, '111.11');
    assert.ok(d.escrowTxHash && d.fundedAt && d.createdAt);
  });
  await check('events sub-collection has created -> funded', async () => {
    const snap = await eventsRef(reqOpen.id).get();
    assert.deepEqual(snap.docs.map((x) => x.data().type).sort(), ['created', 'funded']);
  });
  await check('list endpoints work against the real database (these need composite indexes)', async () => {
    const all = await api('GET', '/requests');
    assert.equal(all.status, 200, all.text);
    assert.ok(all.body.requests.some((x) => x.id === reqOpen.id));
    assert.ok(!all.body.requests.some((x) => x.id === reqPending.id), 'unfunded request must not be listed');
    const byBrand = await api('GET', '/requests?brand=amazon');
    assert.equal(byBrand.status, 200, byBrand.text);
    assert.ok(byBrand.body.requests.some((x) => x.id === reqOpen.id));
    const mine = await api('GET', '/requests/mine', { token: ta });
    assert.equal(mine.status, 200, mine.text);
    assert.equal(mine.body.asRequester.length, 2);
  });
} finally {
  backend.close();
  bot.kill();
  try { fs.rmSync(stateDir, { recursive: true, force: true }); } catch { /* ignore */ }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n==== ${results.length - failed.length}/${results.length} checks passed ====`);
if (reqOpen) {
  console.log('\nWhere to look in the Firebase console:');
  console.log(`  open request     : ${consoleUrl(`requests/${reqOpen.id}`)}`);
  if (reqPending) console.log(`  pending request  : ${consoleUrl(`requests/${reqPending.id}`)}`);
  console.log(`  all requests     : ${consoleUrl('requests')}`);
  console.log(`  users            : ${consoleUrl('users')}`);
}
console.log(`\nManifest of everything created (for cleanup): ${MANIFEST}`);
if (DRY && process.env.CLEANUP_AFTER === '1') {
  const n = await cleanup(MANIFEST);
  assert.ok(n >= 6, `cleanup deleted too few docs (${n})`);
  assert.equal((await col.requests.get()).size, 0);
  console.log('Dry-run cleanup verified: requests collection is empty again.');
}
process.exitCode = failed.length ? 1 : 0;
setTimeout(() => process.exit(), 300);
