// Drives the REAL app in a headless Edge with a fake browser wallet (a throwaway key) to check the first-time card flow:
// connect -> the "Add your cards" pop-up appears once -> search, pick, add -> the card shows in My cards and is saved in Firestore
// -> the pop-up does not come back. Needs the backend (real Firestore, WORLD_ID_DEV_BYPASS=true) on :8080 and the frontend dev server
// (VITE_WORLD_ID_BYPASS=true) on :5173. Deletes everything it creates.
//   CONFIRM_REAL_FIRESTORE=yes node scripts/ui-cards-e2e.mjs
import 'dotenv/config';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import { keccak256, toBytes } from 'viem';

if (process.env.CONFIRM_REAL_FIRESTORE !== 'yes') { console.error('Refusing: this writes to the real Firestore (and cleans up). Set CONFIRM_REAL_FIRESTORE=yes'); process.exit(2); }
const APP = process.env.APP_URL || 'http://localhost:5173';
const EDGE = [process.env.EDGE_PATH, 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', 'C:/Program Files/Microsoft/Edge/Application/msedge.exe'].find((p) => p && fs.existsSync(p));
if (!EDGE) { console.error('Edge not found. Set EDGE_PATH.'); process.exit(2); }
const SHOTS = process.env.SHOTS_DIR || os.tmpdir();
const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
const db = getFirestore(initializeApp({ credential: cert(sa), projectId: sa.project_id }));

const acct = privateKeyToAccount(generatePrivateKey());
const addr = acct.address.toLowerCase();
const port = 9300 + Math.floor(Math.random() * 400);
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'np-ui-'));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
async function check(name, fn) { try { await fn(); results.push(true); console.log(`  PASS  ${name}`); } catch (e) { results.push(false); console.log(`  FAIL  ${name}\n        ${String(e.message).replace(/\s+/g, ' ').slice(0, 400)}`); } }

// ---- the fake wallet the page sees as window.ethereum (signing happens here in Node)
const MOCK = `(() => {
  const addr = ${JSON.stringify(acct.address)}; let n = 0; const pending = new Map(); const ls = {};
  window.__resolveSign = (i, sig, err) => { const p = pending.get(i); if (!p) return; pending.delete(i); err ? p.reject(new Error(err)) : p.resolve(sig); };
  const provider = {
    isMetaMask: true,
    request: async ({ method, params }) => {
      switch (method) {
        case 'eth_requestAccounts': case 'eth_accounts': return [addr];
        case 'eth_chainId': return '0x4cef52';
        case 'net_version': return '5042002';
        case 'personal_sign': { const i = ++n; const r = new Promise((resolve, reject) => pending.set(i, { resolve, reject })); window.__sign(JSON.stringify({ id: i, message: params[0] })); return r; }
        case 'eth_getBalance': return '0x0';
        case 'eth_call': return '0x' + '0'.repeat(64);
        case 'wallet_switchEthereumChain': case 'wallet_addEthereumChain': case 'wallet_revokePermissions': case 'wallet_requestPermissions': return null;
        default: throw Object.assign(new Error('unsupported ' + method), { code: -32601 });
      }
    },
    on(e, f) { (ls[e] ||= []).push(f); }, removeListener(e, f) { ls[e] = (ls[e] || []).filter((x) => x !== f); },
  };
  Object.defineProperty(window, 'ethereum', { value: provider, configurable: true });
})();`;

// ---- minimal Chrome DevTools Protocol client (Node's built-in WebSocket)
const browser = spawn(EDGE, [`--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--headless=new', '--disable-gpu', '--window-size=1300,950', '--no-first-run', 'about:blank'], { stdio: 'ignore' });
let ws, seq = 0; const waiting = new Map(); const consoleErrors = [];
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++seq; waiting.set(id, { resolve, reject }); ws.send(JSON.stringify({ id, method, params })); });
const evalJS = async (expression) => { const r = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
const waitFor = async (expression, ms = 20000, what = expression) => { const t = Date.now(); for (;;) { try { const v = await evalJS(expression); if (v) return v; } catch { /* page navigating */ } if (Date.now() - t > ms) throw new Error(`timed out waiting for: ${what}`); await sleep(250); } };
const shot = async (name) => { const r = await send('Page.captureScreenshot', { format: 'png' }); const f = path.join(SHOTS, `ui-${name}.png`); fs.writeFileSync(f, Buffer.from(r.data, 'base64')); return f; };
const clickText = (selector, text) => evalJS(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(selector)})].find((e) => e.innerText && e.innerText.replace(/\\s+/g, ' ').trim().includes(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
const promptOpen = () => evalJS(`!!document.querySelector('[role="dialog"][aria-labelledby="cards-prompt-title"]')`);

async function cleanup() {
  try {
    const cards = await db.collection('users').doc(addr).collection('cards').get();
    for (const d of cards.docs) await d.ref.delete();
    await db.collection('users').doc(addr).delete().catch(() => {});
    await db.collection('authNonces').doc(addr).delete().catch(() => {});
    await db.collection('worldIdNullifiers').doc(keccak256(toBytes(`netpositive-dev-bypass:${addr}`))).delete().catch(() => {});
    const left = (await db.collection('users').doc(addr).collection('cards').get()).size + ((await db.collection('users').doc(addr).get()).exists ? 1 : 0) + ((await db.collection('authNonces').doc(addr).get()).exists ? 1 : 0);
    console.log(`\nCleanup: ${left === 0 ? 'everything this run created in Firestore was deleted' : `${left} document(s) left for ${addr}`}`);
    if (left) results.push(false);
  } catch (e) { console.log('Cleanup problem:', e.message); results.push(false); }
}

try {
  let target;
  for (let i = 0; i < 60 && !target; i++) { try { target = (await (await fetch(`http://127.0.0.1:${port}/json/list`)).json()).find((t) => t.type === 'page'); } catch { await sleep(300); } }
  assert.ok(target, 'could not reach the browser');
  ws = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => { ws.onopen = res; ws.onerror = rej; });
  ws.onmessage = async (m) => {
    const msg = JSON.parse(m.data);
    if (msg.id && waiting.has(msg.id)) { const w = waiting.get(msg.id); waiting.delete(msg.id); return msg.error ? w.reject(new Error(msg.error.message)) : w.resolve(msg.result); }
    if (msg.method === 'Runtime.bindingCalled' && msg.params.name === '__sign') {
      const { id, message } = JSON.parse(msg.params.payload);
      try { const text = /^0x/.test(message) ? Buffer.from(message.slice(2), 'hex').toString('utf8') : message; const sig = await acct.signMessage({ message: text }); await evalJS(`window.__resolveSign(${id}, ${JSON.stringify(sig)})`); }
      catch (e) { await evalJS(`window.__resolveSign(${id}, null, ${JSON.stringify(String(e.message))})`); }
    }
    if (msg.method === 'Runtime.exceptionThrown') consoleErrors.push(msg.params.exceptionDetails.exception?.description || msg.params.exceptionDetails.text);
    if (msg.method === 'Runtime.consoleAPICalled' && msg.params.type === 'error') consoleErrors.push(msg.params.args.map((a) => a.value ?? a.description).join(' ').slice(0, 300));
  };
  await send('Page.enable'); await send('Runtime.enable');
  await send('Runtime.addBinding', { name: '__sign' });
  await send('Page.addScriptToEvaluateOnNewDocument', { source: MOCK });
  await send('Emulation.setDeviceMetricsOverride', { width: 1300, height: 950, deviceScaleFactor: 1, mobile: false });

  console.log(`App ${APP}   fake wallet ${acct.address}   (throwaway; cleaned up at the end)\n`);
  await send('Page.navigate', { url: `${APP}/trade` });
  await waitFor(`document.body && document.body.innerText.includes('Trade')`, 30000, 'the app to load');

  await check('before connecting there is no pop-up', async () => { await sleep(1500); assert.equal(await promptOpen(), false); });
  await check('connect the fake wallet from the header (connects, then registers via the dev bypass and signs in)', async () => {
    assert.ok(await clickText('button', 'Connect'), 'no Connect button');
    await waitFor(`document.body.innerText.includes('MetaMask')`, 10000, 'the wallet list');
    assert.ok(await clickText('button', 'MetaMask'), 'no MetaMask row');
    await waitFor(`document.body.innerText.includes('${acct.address.slice(0, 6)}')`, 20000, 'the wallet address in the header');
  });
  await check('the account now exists in Firestore with a session', async () => {
    for (let i = 0; i < 40; i++) { if ((await db.collection('users').doc(addr).get()).exists) return; await sleep(500); }
    assert.fail('no users document appeared');
  });
  await check('the "Add your cards" pop-up appears', async () => {
    await waitFor(`!!document.querySelector('[role="dialog"][aria-labelledby="cards-prompt-title"]')`, 25000, 'the pop-up');
    console.log('        screenshot:', await shot('1-popup'));
  });
  await check('the pop-up lists the cards and the search narrows them', async () => {
    const all = await evalJS(`document.querySelectorAll('[role="dialog"] [role="group"] button').length`);
    assert.ok(all >= 30, `only ${all} cards listed`);
    await evalJS(`(() => { const i = document.querySelector('input[aria-label="Search cards"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(i, 'hdfc infinia'); i.dispatchEvent(new Event('input', { bubbles: true })); })()`);
    await waitFor(`document.querySelectorAll('[role="dialog"] [role="group"] button').length <= 3`, 5000, 'results to narrow');
    const first = await evalJS(`document.querySelector('[role="dialog"] [role="group"] button').innerText`);
    assert.match(first, /HDFC Infinia/);
  });
  await check('tick HDFC Infinia and add it: the pop-up closes', async () => {
    await evalJS(`document.querySelector('[role="dialog"] [role="group"] button').click()`);
    assert.ok(await clickText('[role="dialog"] button', 'Add 1 card'), 'no Add button');
    await waitFor(`!document.querySelector('[role="dialog"][aria-labelledby="cards-prompt-title"]')`, 8000, 'the pop-up to close');
    console.log('        screenshot:', await shot('2-after-add'));
  });
  await check('the card is saved in Firestore (users/{wallet}/cards/hdfc_infinia)', async () => {
    for (let i = 0; i < 30; i++) { const d = await db.collection('users').doc(addr).collection('cards').doc('hdfc_infinia').get(); if (d.exists) { assert.equal(d.data().issuer, 'HDFC'); assert.equal(d.data().last, 'Verified rates'); return; } await sleep(500); }
    assert.fail('the card never reached Firestore');
  });
  await check('"closed for good" is saved on the account too', async () => {
    for (let i = 0; i < 20; i++) { if ((await db.collection('users').doc(addr).get()).data()?.cardsPromptDismissed === true) return; await sleep(500); }
    assert.fail('cardsPromptDismissed was not saved');
  });
  await check('My cards shows the new card', async () => {
    assert.ok(await clickText('a', 'My cards'), 'no My cards link');
    await waitFor(`location.pathname === '/cards' && document.body.innerText.includes('Infinia')`, 10000, 'Infinia on the My cards page');
    console.log('        screenshot:', await shot('3-my-cards'));
  });
  await check('after a full reload the card is still there (read back from Firestore) and the pop-up stays away', async () => {
    await send('Page.navigate', { url: `${APP}/cards` });
    await waitFor(`document.body.innerText.includes('Infinia')`, 25000, 'Infinia after reload');
    await sleep(2000);
    assert.equal(await promptOpen(), false);
  });
  await check('no unexpected errors were logged by the page', async () => {
    const bad = consoleErrors.filter((e) => !/favicon|ResizeObserver|Failed to load resource|WalletConnect|net::ERR/i.test(e));
    assert.deepEqual(bad, []);
  });
} catch (e) {
  results.push(false);
  console.log('  FAIL  setup/flow:', String(e.message).slice(0, 400));
  try { console.log('        screenshot:', await shot('failure')); console.log('        page text:', String(await evalJS('document.body.innerText')).replace(/\s+/g, ' ').slice(0, 500)); } catch { /* browser gone */ }
  if (consoleErrors.length) console.log('        page errors:', consoleErrors.slice(0, 5));
} finally {
  try { ws?.close(); } catch { /* closed */ }
  browser.kill();
  await cleanup();
  try { fs.rmSync(profile, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 }); } catch { /* Edge may still hold the temp profile; harmless */ }
  console.log(`\n==== ${results.filter(Boolean).length}/${results.length} checks passed ====`);
  process.exit(results.every(Boolean) ? 0 : 1);
}
