// End-to-end: injected EIP-6963 wallets (real secp256k1 signatures via viem) against the local backend (dev:mem).
// node e2e.mjs [walletKind=rabby|legacy] [shotsPrefix]
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
const viemAcc = await import(new URL('../../../backend/node_modules/viem/_esm/accounts/index.js', import.meta.url).href);
const kind = process.argv[2] || 'rabby';
const prefix = process.argv[3] || kind;
const OUT = new URL('./shots/', import.meta.url).pathname;
const BASE = 'http://127.0.0.1:5173';
const account = viemAcc.privateKeyToAccount(viemAcc.generatePrivateKey());

export async function newWalletPage(browser, acct, walletKind, viewport = { width: 1280, height: 900 }) {
  const ctx = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push('pageerror: ' + e.message));
  page.on('console', (m) => { if (m.type() === 'error' && !/favicon|Failed to load resource/.test(m.text())) errors.push('console: ' + m.text().slice(0, 220)); });
  await page.exposeFunction('__npSign', async (hex) => acct.signMessage({ message: { raw: hex } }));
  await page.exposeFunction('__npSignTyped', async (json) => {
    const td = typeof json === 'string' ? JSON.parse(json) : json;
    const { EIP712Domain, ...types } = td.types;
    return acct.signTypedData({ domain: td.domain, types, primaryType: td.primaryType, message: td.message });
  });
  await page.addInitScript(({ address, walletKind }) => {
    const listeners = {};
    let chainId = '0x1';
    let connected = localStorage.getItem('np.test.connected') === '1';
    const emit = (ev, v) => (listeners[ev] || []).forEach((f) => f(v));
    const provider = {
      isTestWallet: true,
      ...(walletKind === 'rabby' ? { isRabby: true, isMetaMask: true } : {}),
      calls: [],
      async request({ method, params }) {
        provider.calls.push(method);
        switch (method) {
          case 'eth_requestAccounts': connected = true; localStorage.setItem('np.test.connected', '1'); return [address];
          case 'eth_accounts': return connected ? [address] : [];
          case 'eth_chainId': return chainId;
          case 'net_version': return String(parseInt(chainId, 16));
          case 'personal_sign': return window.__npSign(params[0]);
          case 'eth_signTypedData_v4': return window.__npSignTyped(params[1]);
          case 'wallet_switchEthereumChain': {
            const want = params[0].chainId;
            if (walletKind === 'phantom' && want === '0x4cef52') { const e = new Error('Unsupported chain'); e.code = 4902; throw e; }
            if (want === '0x4cef52' && !window.__arcAdded) { const e = new Error('Unrecognized chain ID "0x4cef52". Try adding the chain using wallet_addEthereumChain first.'); e.code = 4902; throw e; }
            chainId = want; emit('chainChanged', chainId); return null;
          }
          case 'wallet_addEthereumChain': if (walletKind === 'phantom') { const e = new Error('The method "wallet_addEthereumChain" is not supported.'); e.code = 4200; throw e; } window.__arcAdded = true; return null;
          case 'wallet_revokePermissions': connected = false; localStorage.removeItem('np.test.connected'); return null;
          case 'eth_getBalance': return '0x' + (25n * 10n ** 18n).toString(16);
          case 'eth_call': return '0x' + (25n * 10n ** 6n).toString(16).padStart(64, '0');
          case 'eth_sendTransaction': return '0x' + crypto.getRandomValues(new Uint8Array(32)).reduce((s, b) => s + b.toString(16).padStart(2, '0'), '');
          case 'eth_getTransactionReceipt': return { status: '0x1' };
          default: throw Object.assign(new Error('unsupported ' + method), { code: 4200 });
        }
      },
      on(ev, f) { (listeners[ev] ||= []).push(f); },
      removeListener(ev, f) { listeners[ev] = (listeners[ev] || []).filter((x) => x !== f); },
    };
    if (walletKind === 'legacy') {
      // An older wallet that only injects window.ethereum (no EIP-6963).
      window.ethereum = provider;
    } else {
      const info = { uuid: 'test-' + walletKind, name: walletKind === 'rabby' ? 'Rabby Wallet' : walletKind === 'phantom' ? 'Phantom' : 'Test Wallet', icon: 'data:image/svg+xml,%3Csvg xmlns=%22http://www.w3.org/2000/svg%22 viewBox=%220 0 32 32%22%3E%3Crect width=%2232%22 height=%2232%22 rx=%228%22 fill=%22%237084ff%22/%3E%3C/svg%3E', rdns: walletKind === 'rabby' ? 'io.rabby' : walletKind === 'phantom' ? 'app.phantom' : 'io.example.wallet' };
      const announce = () => window.dispatchEvent(new CustomEvent('eip6963:announceProvider', { detail: Object.freeze({ info, provider }) }));
      window.addEventListener('eip6963:requestProvider', announce);
      announce();
    }
  }, { address: acct.address, walletKind });
  return { ctx, page, errors };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const browser = await chromium.launch();
  const { page, errors } = await newWalletPage(browser, account, kind);
  const step = async (name, fn) => { const t = Date.now(); try { await fn(); console.log(`  ✓ ${name} (${Date.now() - t}ms)`); } catch (e) { console.log(`  ✗ ${name}: ${e.message.split('\n')[0]}`); await page.screenshot({ path: OUT + prefix + '-FAIL-' + name.replace(/\W+/g, '_') + '.png' }); throw e; } };
  await step('landing loads', async () => { await page.goto(BASE + '/', { waitUntil: 'networkidle' }); });
  await step('open wallet sheet', async () => { await page.getByTestId('hero-connect').click(); await page.getByTestId('wallet-list').waitFor(); });
  const id = kind === 'rabby' ? 'wallet-rabby' : kind === 'legacy' ? 'wallet-injected' : 'wallet-io.example.wallet';
  await page.screenshot({ path: OUT + prefix + '-wallets.png' });
  await step('connect ' + kind, async () => {
    const btn = page.getByTestId(id);
    await btn.click();
    await page.waitForURL('**/trade**', { timeout: 15000 });
  });
  await step('verified human via World ID (dev bypass)', async () => { await page.getByLabel('Verified human').first().waitFor({ timeout: 8000 }); });
  await step('cards prompt: not now', async () => { const b = page.getByRole('button', { name: 'Not now' }); await b.waitFor({ timeout: 5000 }); await page.screenshot({ path: OUT + prefix + '-cardsprompt.png' }); await b.click(); await page.waitForTimeout(400); });
  await page.waitForTimeout(800);
  await page.screenshot({ path: OUT + prefix + '-trade.png', fullPage: true });
  for (const p of ['market', 'cards', 'track', 'dispute']) {
    await step('page /' + p, async () => { await page.goto(BASE + '/' + p, { waitUntil: 'networkidle' }); await page.waitForTimeout(900); await page.screenshot({ path: OUT + prefix + '-' + p + '.png', fullPage: true }); });
  }
  await step('reload keeps wallet connected', async () => {
    await page.goto(BASE + '/track', { waitUntil: 'networkidle' });
    await page.getByTestId('account-chip').waitFor({ timeout: 8000 });
    if (!page.url().includes('/track')) throw new Error('bounced to ' + page.url());
  });
  await step('switch to Arc (adds chain)', async () => {
    await page.getByTestId('account-chip').click();
    await page.getByTestId('switch-arc').click();
    await page.getByText('Arc Testnet').first().waitFor({ timeout: 8000 });
    await page.screenshot({ path: OUT + prefix + '-account.png' });
    await page.keyboard.press('Escape');
  });
  console.log(errors.length ? 'ERRORS:\n' + [...new Set(errors)].join('\n') : 'no console errors');
  await browser.close();
}
