// LOCAL DEMO SERVER. Zero setup: in-memory Firestore, mock escrow, World ID dev bypass.
//   cd backend && npm run dev:mem          (then: cd apps/web-v2 && npm run dev)
//
// Everything a person does in the app works end to end (sign in, Proof of Human step, post, accept, deliver, settle, dispute),
// but nothing is stored after you stop it and no real USDC moves. Each wallet counts as its own verified human.
// Use the real World ID instead: WORLD_ID=real npm run dev:mem  (needs WORLD_ID_RP_ID + WORLD_ID_SIGNING_KEY in the shell env).
// Live rates (/rates) still call the real exchanges when your network allows it.
import crypto from 'node:crypto';

const real = process.env.WORLD_ID === 'real';
const defaults = {
  NODE_ENV: 'development',
  PORT: '8080',
  JWT_SECRET: crypto.randomBytes(32).toString('hex'),
  VOUCHER_ENC_KEY: crypto.randomBytes(32).toString('hex'),
  FIREBASE_PROJECT_ID: 'demo-netpositive',
  WORLD_ID_APP_ID: 'app_ee3eaaf80b272b3dff6854c30744dd65',
  WORLD_ID_ENV: 'staging',
  WORLD_ID_DEV_BYPASS: real ? 'false' : 'true',
  ESCROW_MODE: 'mock',
  SWEEP_INTERVAL_SECONDS: '30',
  CORS_ORIGINS: 'http://localhost:5173,http://127.0.0.1:5173',
};
for (const [k, v] of Object.entries(defaults)) if (process.env[k] === undefined) process.env[k] = v;

await import('../src/index.js');

// Seed a few open orders from demo wallets so the market isn't empty (SEED=0 to skip). Real API calls, real signatures.
if (process.env.SEED !== '0') {
  const { generatePrivateKey, privateKeyToAccount } = await import('viem/accounts');
  const base = `http://127.0.0.1:${process.env.PORT}`;
  const post = async (path, body, token) => {
    const r = await fetch(base + path, { method: 'POST', headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(`${path}: ${r.status} ${JSON.stringify(j).slice(0, 160)}`);
    return j;
  };
  const orders = [
    ['amazon', 5000, 101.4], ['myntra', 2500, 102.1], ['flipkart', 10000, 100.9], ['swiggy', 1000, 102.6],
    ['makemytrip', 15000, 100.6], ['zomato', 1500, 102.2], ['bigbasket', 3000, 101.8], ['blinkit', 750, 102.9],
  ];
  try {
    await new Promise((r) => setTimeout(r, 300));
    for (const [i, [brand, inr, rate]] of orders.entries()) {
      const acct = privateKeyToAccount(generatePrivateKey());
      const { message } = await post('/auth/nonce', { address: acct.address });
      const { token } = await post('/auth/verify', { address: acct.address, signature: await acct.signMessage({ message }) });
      if (process.env.WORLD_ID_DEV_BYPASS === 'true') await post('/world-id/verify', {}, token);
      const usdc = ((inr / rate) * 1.01).toFixed(6).replace(/\.?0+$/, '');
      const { request } = await post('/requests', { brand, amountInr: inr, amountUsdc: usdc }, token);
      await post(`/requests/${request.id}/fund`, { txHash: '0x' + (i + 1).toString(16).padStart(64, 'a') }, token);
    }
    console.log(`  seeded ${orders.length} open demo orders (SEED=0 to skip)`);
  } catch (e) {
    console.warn('  could not seed demo orders:', e.message);
  }
}
console.log(`
  NetPositive local demo backend
    database   in memory (wiped when you stop it)
    escrow     mock (no USDC moves)
    World ID   ${real ? 'real (needs WORLD_ID_RP_ID and WORLD_ID_SIGNING_KEY)' : 'dev bypass (each wallet counts as one human)'}
  Frontend:  cd apps/web-v2 && npm run dev   ->  http://localhost:5173
`);
