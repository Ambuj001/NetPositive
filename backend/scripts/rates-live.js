// Live check of every rate source from THIS machine (no database, no server):
//   npm run rates:live -- 10000      # trade size in ₹ (default 10,000)
// Prints USD/INR, P2P buy/sell and spot for USDT and USDC with each source's answer or error.
Object.assign(process.env, {
  JWT_SECRET: process.env.JWT_SECRET || 'x'.repeat(48),
  VOUCHER_ENC_KEY: process.env.VOUCHER_ENC_KEY || '0'.repeat(64),
  FIREBASE_PROJECT_ID: process.env.FIREBASE_PROJECT_ID || 'demo-netpositive',
  WORLD_ID_APP_ID: process.env.WORLD_ID_APP_ID || 'app_unused',
});
const { getForex, getP2P, getBooks } = await import('../src/rates/service.js');
const amountInr = Number(process.argv[2] ?? 10_000);
const show = (label, r) => {
  console.log(`\n${label}`);
  for (const s of r.sources) console.log(`  ${s.ok ? '✓' : '✗'} ${s.name.padEnd(12)} ${s.ok ? (s.rate ?? s.price ?? s.mid) + (s.eligible != null ? `  (${s.eligible} ads fit, best ${s.best}${s.relaxed ? ', relaxed' : ''})` : s.bestBid != null ? `  (bid ${s.bestBid} / ask ${s.bestAsk})` : `  (${s.kind})`) : s.error}`);
};
const fx = await getForex().catch((e) => ({ error: e.message, sources: [] }));
show(`USD/INR = ${fx.rate ?? fx.error}`, fx);
for (const asset of ['USDT', 'USDC']) {
  for (const side of ['buy', 'sell']) {
    const r = await getP2P({ asset, side, amountInr }).catch((e) => ({ error: e.message, sources: e.details?.lastKnown?.sources ?? [] }));
    show(`${asset} P2P ${side} for ₹${amountInr} = ${r.price ?? r.error}${r.price && fx.rate ? `  (${((r.price / fx.rate - 1) * 100).toFixed(2)}% over forex)` : ''}`, r);
  }
  const b = await getBooks({ asset, amountInr }).catch((e) => ({ error: e.message, sources: [] }));
  show(`${asset} spot mid = ${b.mid ?? b.error}`, b);
}
process.exit(0);
