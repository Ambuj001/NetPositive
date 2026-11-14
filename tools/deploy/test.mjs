// Deploys with exactly the data the page gives the wallet, on a local anvil chain, and reads the contract back.
//   node tools/deploy/test.mjs      (needs Foundry: anvil and forge)
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildPage } from './serve.mjs';
import * as E from './encode.js';

const { html, bytecode } = buildPage();
assert.ok(!html.includes('/*__'), 'every placeholder in the page is filled');
// The inlined page script must parse as a module.
const script = /<script type="module">([\s\S]*)<\/script>/.exec(html)[1];
const dir = mkdtempSync(join(tmpdir(), 'np-deploy-'));
writeFileSync(join(dir, 'page.mjs'), script);
const { spawnSync } = await import('node:child_process');
assert.equal(spawnSync(process.execPath, ['--check', join(dir, 'page.mjs')]).status, 0, 'page script has a syntax error');

const port = 8900 + Math.floor(Math.random() * 90);
const anvil = spawn('anvil', ['--port', String(port), '--silent'], { stdio: 'ignore' });
process.on('exit', () => anvil.kill());
const rpc = async (method, params = []) => {
  const r = await (await fetch(`http://127.0.0.1:${port}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) })).json();
  if (r.error) throw new Error(r.error.message);
  return r.result;
};
for (let i = 0; ; i++) { try { await rpc('eth_chainId'); break; } catch { if (i > 50) throw new Error('anvil did not start'); await new Promise((r) => setTimeout(r, 100)); } }
const receipt = async (h) => { for (;;) { const r = await rpc('eth_getTransactionReceipt', [h]); if (r) return r; await new Promise((res) => setTimeout(res, 50)); } };

const [deployer, arbiter, guardian, treasury, reserve] = await rpc('eth_accounts');
const p = { owner: deployer, arbiter, guardian, treasury, reserve, feeBps: 100, reserveShareBps: 5000, reviewWindow: 86400, fulfillWindow: 7200, minUsdc: '1', maxUsdc: '250', capUsdc: '5000', bondUsdc: '1' };

assert.deepEqual(E.problems(p), []);
assert.ok(E.problems({ ...p, arbiter: deployer }).some((m) => m.includes('arbiter must be a different')));
assert.ok(E.problems({ ...p, feeBps: 501 }).length > 0);
assert.ok(E.problems({ ...p, reviewWindow: 60 }).length > 0);
assert.ok(E.problems({ ...p, capUsdc: '100' }).some((m) => m.includes('total cap')));
assert.ok(E.problems({ ...p, treasury: '0x123' }).length > 0);

// setToken requires the token to be a contract: put code at the USDC address on the local chain.
await rpc('anvil_setCode', [E.ARC_USDC, '0x00']);

const d = await receipt(await rpc('eth_sendTransaction', [{ from: deployer, data: E.creationData(bytecode, p) }]));
assert.equal(d.status, '0x1', 'deployment reverted');
const contract = d.contractAddress;
const call = (data) => rpc('eth_call', [{ to: contract, data }, 'latest']);
const read = async () => { const o = {}; for (const [k, sel] of Object.entries(E.READS)) o[k] = await call(sel); return o; };

assert.deepEqual(E.mismatches(p, await read()), [], 'roles and settings read back as entered');
assert.ok(E.tokenMismatches(p, await call(E.tokenConfigCall())).includes('USDC is not enabled'), 'no deposits possible before enable');

// only the owner can enable USDC
const notOwner = await rpc('eth_sendTransaction', [{ from: arbiter, to: contract, data: E.setTokenData(p), gas: '0x30000' }]).then(receipt).catch(() => ({ status: '0x0' }));
assert.equal(notOwner.status, '0x0', 'a non-owner must not be able to enable USDC');

const s = await receipt(await rpc('eth_sendTransaction', [{ from: deployer, to: contract, data: E.setTokenData(p) }]));
assert.equal(s.status, '0x1', 'setToken reverted');
assert.deepEqual(E.tokenMismatches(p, await call(E.tokenConfigCall())), [], 'USDC limits and stake read back as entered');
assert.ok(E.mismatches({ ...p, feeBps: 200 }, await read()).length === 1, 'a wrong setting is reported');

console.log('deploy page: encoding, validation and on-chain read-back all verified on a local chain');
anvil.kill();
process.exit(0);
