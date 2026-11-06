// Compiles contracts/src/*.sol and contracts/test/*.sol with solc-js into contracts/build/<Name>.json ({abi, bytecode}).
// evmVersion "paris" (no PUSH0) so the bytecode runs on any EVM chain, including Arc.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const solc = require('solc');
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sources = {};
for (const dir of ['src', 'test']) {
  for (const f of fs.readdirSync(path.join(root, dir))) {
    if (f.endsWith('.sol')) sources[`${dir}/${f}`] = { content: fs.readFileSync(path.join(root, dir, f), 'utf8') };
  }
}
// The existing, deployed escrow lives one level up (contracts/src). It is compiled here as a read-only reference so the tests run
// against its real source. Nothing in contracts/src, contracts/test or foundry.toml is modified by this module.
const escrowSrc = path.join(root, '..', 'src', 'VoucherEscrow.sol');
if (fs.existsSync(escrowSrc)) sources['escrow/VoucherEscrow.sol'] = { content: fs.readFileSync(escrowSrc, 'utf8') };
const input = {
  language: 'Solidity',
  sources,
  settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object'] } } },
};
function findImports(p) {
  const candidates = [path.join(root, 'node_modules', p), path.join(root, p)];
  for (const c of candidates) if (fs.existsSync(c)) return { contents: fs.readFileSync(c, 'utf8') };
  return { error: `File not found: ${p}` };
}
const out = JSON.parse(solc.compile(JSON.stringify(input), { import: findImports }));
let failed = false;
for (const e of out.errors ?? []) {
  console.error(`${e.severity.toUpperCase()}: ${e.formattedMessage.trim()}`);
  if (e.severity === 'error') failed = true;
}
if (failed) process.exit(1);
fs.mkdirSync(path.join(root, 'build'), { recursive: true });
for (const [file, contracts] of Object.entries(out.contracts)) {
  if (!file.startsWith('src/') && !file.startsWith('test/') && !file.startsWith('escrow/')) continue;
  for (const [name, c] of Object.entries(contracts)) {
    fs.writeFileSync(path.join(root, 'build', `${name}.json`), JSON.stringify({ abi: c.abi, bytecode: `0x${c.evm.bytecode.object}`, deployedBytecode: `0x${c.evm.deployedBytecode.object}` }));
    console.log(`compiled ${name} (${c.evm.bytecode.object.length / 2} bytes)`);
  }
}
