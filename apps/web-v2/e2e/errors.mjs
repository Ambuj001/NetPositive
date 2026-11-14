// What people see when something goes wrong: a stale session, a server error before the World App step,
// and a wallet that can't add Arc Testnet. Local backend (npm run dev:mem) + Vite.
import { createRequire } from 'node:module';
import { newWalletPage } from './wallets.mjs';
const { chromium } = createRequire(import.meta.url)('playwright');
const acc = await import(new URL('../../../backend/node_modules/viem/_esm/accounts/index.js', import.meta.url).href);
const OUT = new URL('./shots/', import.meta.url).pathname;
const BASE = 'http://127.0.0.1:5173';
const browser = await chromium.launch();
const fresh = (kind) => newWalletPage(browser, acc.privateKeyToAccount(acc.generatePrivateKey()), kind);
let failed = 0;
const step = async (name, page, fn) => {
  try { await fn(); console.log('  ✓ ' + name); } catch (e) { failed++; console.log('  ✗ ' + name + ': ' + e.message.split('\n')[0]); await page.screenshot({ path: OUT + 'errors-FAIL-' + name.replace(/\W+/g, '_').slice(0, 40) + '.png' }); }
};
const open = async (page, testid) => { await page.goto(BASE + '/', { waitUntil: 'networkidle' }); await page.getByTestId('hero-connect').click(); await page.getByTestId(testid).click(); };

// 1) The saved session is rejected once (expired / server restarted): the app signs in again by itself.
{
  const { page } = await fresh('rabby');
  let hits = 0;
  await page.route('**/api/world-id/verify', (route) => (++hits === 1 ? route.fulfill({ status: 401, contentType: 'application/json', body: JSON.stringify({ error: 'unauthorized', message: 'Invalid or expired token' }) }) : route.continue()));
  await step('stale session: signs in again once and still verifies', page, async () => {
    await open(page, 'wallet-rabby');
    await page.waitForURL('**/trade**', { timeout: 15000 });
    await page.getByLabel('Verified human').first().waitFor({ timeout: 8000 });
    if (hits !== 2) throw new Error('expected a retry, saw ' + hits + ' calls');
    const signs = await page.evaluate(() => window.ethereum ? 0 : 0);
  });
}

// 2) The server fails before the World App step: say so, with the log reference, and don't blame the proof.
{
  const { page } = await fresh('rabby');
  await page.route('**/api/world-id/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ app_id: 'app_staging_x', rp_id: 'rp_x', action: 'netpositive-account', environment: 'staging', ready: true, problem: null, bypass: false, mock: false }) }));
  await page.route('**/api/world-id/rp-signature', (route) => route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ error: 'internal_error', message: 'The server hit an unexpected error (ref ab12cd34).', details: { ref: 'ab12cd34' } }) }));
  await step('server error before World App: named stage + log reference', page, async () => {
    await open(page, 'wallet-rabby');
    const note = page.getByRole('status').filter({ hasText: "Couldn't start World ID" }).first();
    await note.waitFor({ timeout: 10000 });
    const text = await note.innerText();
    if (!/ref ab12cd34/.test(text) || !/isn't about your proof/.test(text)) throw new Error('unexpected text: ' + text);
    if (/Proof rejected/.test(text)) throw new Error('still says Proof rejected');
    await page.screenshot({ path: OUT + 'errors-server.png' });
  });
}

// 3) The server's settings are unusable: the reason from the server is shown as-is.
{
  const { page } = await fresh('rabby');
  await page.route('**/api/world-id/config', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ app_id: 'app_staging_x', rp_id: 'app_x', action: 'netpositive-account', environment: 'staging', ready: false, problem: 'WORLD_ID_RP_ID should look like rp_… (copy it from the World Developer Portal, World ID 4.0 section). It is not the app id.', bypass: false }) }));
  await step('bad server settings: shows what to fix', page, async () => {
    await open(page, 'wallet-rabby');
    await page.getByRole('status').filter({ hasText: "World ID isn't set up on the server" }).filter({ hasText: 'should look like rp_' }).first().waitFor({ timeout: 10000 });
  });
}

// 4) A wallet that can't add networks (Phantom): labelled in the picker, explained in the account sheet and on Switch.
{
  const { page } = await fresh('phantom');
  await step('Phantom: sign-in works, Arc limits are explained', page, async () => {
    await page.goto(BASE + '/', { waitUntil: 'networkidle' });
    await page.getByTestId('hero-connect').click();
    await page.getByTestId('wallet-phantom').filter({ hasText: "can't use Arc Testnet" }).waitFor({ timeout: 5000 });
    await page.getByTestId('wallet-phantom').click();
    await page.waitForURL('**/trade**', { timeout: 15000 });
    await page.getByRole('button', { name: 'Not now' }).click({ timeout: 6000 }).catch(() => {});
    await page.getByTestId('account-chip').click();
    await page.getByText("USDC paid to this address on Arc won't show up in Phantom").waitFor({ timeout: 5000 });
    await page.getByTestId('switch-arc').click();
    await page.getByRole('status').filter({ hasText: "Phantom can't use Arc Testnet" }).first().waitFor({ timeout: 8000 });
    await page.screenshot({ path: OUT + 'errors-phantom.png' });
  });
}
console.log(failed ? `${failed} failed` : 'all error-path checks passed');
await browser.close();
process.exit(failed ? 1 : 0);
