// Full trade between two wallets through the UI: spender posts + locks, buyer accepts, spender Ready, buyer seals the code,
// spender opens it and settles. Local backend (dev:mem, mock escrow, World ID bypass).
import { createRequire } from 'node:module';
import { newWalletPage } from './wallets.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const acc = await import(new URL('../../../backend/node_modules/viem/_esm/accounts/index.js', import.meta.url).href);
const OUT = new URL('./shots/', import.meta.url).pathname;
const BASE = 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const A = await newWalletPage(browser, acc.privateKeyToAccount(acc.generatePrivateKey()), 'rabby');
const B = await newWalletPage(browser, acc.privateKeyToAccount(acc.generatePrivateKey()), 'other');
let n = 0;
const step = async (who, name, fn) => {
  const page = who.page; const t = Date.now();
  try { await fn(page); console.log(`  ✓ ${name} (${Date.now() - t}ms)`); await page.screenshot({ path: OUT + `trade-${String(++n).padStart(2, '0')}-${name.replace(/\W+/g, '_')}.png`, fullPage: false }); }
  catch (e) { console.log(`  ✗ ${name}: ${e.message.split('\n')[0]}`); await page.screenshot({ path: OUT + `trade-FAIL-${name.replace(/\W+/g, '_')}.png`, fullPage: true }); console.log([...new Set([...A.errors, ...B.errors])].join('\n')); await browser.close(); process.exit(1); }
};
async function connect(page, testid) {
  await page.goto(BASE + '/', { waitUntil: 'networkidle' });
  await page.getByTestId('hero-connect').click();
  await page.getByTestId(testid).click();
  await page.waitForURL('**/trade**', { timeout: 15000 });
  const notNow = page.getByRole('button', { name: 'Not now' });
  await notNow.waitFor({ timeout: 6000 }).then(() => notNow.click()).catch(() => {});
}
let id = '';
await step(A, 'spender connects', (p) => connect(p, 'wallet-rabby'));
await step(A, 'spender opens pay with crypto', async (p) => { await p.goto(BASE + '/trade?mode=sell', { waitUntil: 'networkidle' }); await p.getByRole('button', { name: /Review order/ }).waitFor(); });
await step(A, 'spender reviews order', async (p) => { await p.getByRole('button', { name: /Review order/ }).click(); await p.getByRole('button', { name: /Lock USDC & post order/ }).waitFor(); });
await step(A, 'spender locks USDC', async (p) => {
  await p.getByRole('button', { name: /Lock USDC & post order/ }).click();
  await p.waitForURL('**/track?id=*', { timeout: 20000 });
  id = new URL(p.url()).searchParams.get('id');
  if (!id) throw new Error('no order id');
});
console.log('    order', id);
await step(B, 'buyer connects', (p) => connect(p, 'wallet-io.example.wallet'));
await step(B, 'buyer opens the order', async (p) => { await p.goto(BASE + '/trade/' + id, { waitUntil: 'networkidle' }); await p.getByRole('button', { name: 'Accept order' }).waitFor(); });
await step(B, 'buyer accepts', async (p) => {
  await p.getByRole('button', { name: 'Accept order' }).click();
  await p.getByText(/Buy it this way|Paste your voucher codes/).first().waitFor({ timeout: 10000 });
  const r = await (await fetch('http://127.0.0.1:8080/requests/' + id)).json();
  if (r.request.status !== 'accepted') throw new Error('server status ' + r.request.status);
});
await step(A, 'spender sends Ready', async (p) => {
  await p.goto(BASE + '/track?id=' + id, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /^Ready/ }).click();
  await p.getByText(/Ready sent/).waitFor({ timeout: 15000 });
});
await step(B, 'buyer enters the voucher code', async (p) => {
  await p.goto(BASE + '/trade/' + id, { waitUntil: 'networkidle' });
  const inputs = p.getByPlaceholder('XXXX-XXXX-XXXX-XXXX');
  await inputs.first().waitFor({ timeout: 10000 });
  const k = await inputs.count();
  for (let i = 0; i < k; i++) await inputs.nth(i).fill(`TEST-CODE-${i}-7Q2K91XA`);
});
await step(B, 'buyer seals and sends the code', async (p) => {
  p.on('response', async (r) => { if (/vault|submit-code|requests\//.test(r.url()) && r.request().method() !== 'GET') console.log('     ', r.request().method(), r.url().replace(BASE, ''), r.status(), r.status() >= 400 ? (await r.text()).slice(0, 200) : ''); });
  await p.getByRole('button', { name: /Seal and send/ }).click();
  await p.waitForTimeout(2500);
  console.log('      toasts:', await p.locator('[role=status]').allInnerTexts());
  await p.waitForURL('**/track?id=*', { timeout: 20000 });
  const r = await (await fetch('http://127.0.0.1:8080/requests/' + id)).json();
  if (r.request.status !== 'code_submitted') throw new Error('server status ' + r.request.status);
});
await step(A, 'spender opens the code', async (p) => {
  await p.goto(BASE + '/track?id=' + id, { waitUntil: 'networkidle' });
  await p.getByRole('button', { name: /Show|Reveal|Open/ }).first().click();
  await p.getByText(/TEST-CODE-0/).waitFor({ timeout: 15000 });
});
await step(A, 'spender settles', async (p) => {
  await p.getByRole('button', { name: /Settle transaction/ }).click();
  await p.locator('[role="dialog"] input[type="checkbox"], label:has-text("works") input').first().check().catch(async () => { await p.getByRole('checkbox').first().check(); });
  await p.getByRole('button', { name: /^Release/ }).click();
  await p.getByText(/Settled\./).waitFor({ timeout: 15000 });
  const r = await (await fetch('http://127.0.0.1:8080/requests/' + id)).json();
  if (!['released', 'releasing'].includes(r.request.status)) throw new Error('server status ' + r.request.status);
});
const errs = [...new Set([...A.errors, ...B.errors])];
console.log(errs.length ? 'CONSOLE ERRORS:\n' + errs.join('\n') : 'no console errors');
await browser.close();
