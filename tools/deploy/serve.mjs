// Builds VoucherEscrowV2, then serves the deploy page on http://127.0.0.1:4174 (this machine only).
// Open that address in the browser that has your wallet. Your wallet signs; no key is read or stored here.
//
//   node tools/deploy/serve.mjs
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const here = fileURLToPath(new URL('.', import.meta.url));
const contracts = fileURLToPath(new URL('../../contracts/', import.meta.url));

export function buildPage() {
  const build = spawnSync('forge', ['build'], { cwd: contracts, encoding: 'utf8' });
  if (build.status !== 0) throw new Error('forge build failed:\n' + (build.stderr || build.error?.message));
  const artifact = JSON.parse(readFileSync(`${contracts}out/VoucherEscrowV2.sol/VoucherEscrowV2.json`, 'utf8'));
  const bytecode = artifact.bytecode.object;
  // keccak256 of the creation code, so the page and the terminal can be compared by eye.
  const { keccak256 } = createRequire(`${here}../../backend/`)('viem');
  const codeHash = keccak256(bytecode);
  const encode = readFileSync(`${here}encode.js`, 'utf8').replace(/^export /gm, '');
  const html = readFileSync(`${here}page.html`, 'utf8')
    .replace('/*__ENCODE__*/', () => encode)
    .replace('/*__BYTECODE__*/', () => bytecode)
    .replace('/*__CODEHASH__*/', () => codeHash);
  return { html, bytecode, codeHash };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { html, bytecode, codeHash } = buildPage();
  const port = Number(process.env.PORT || 4174);
  createServer((req, res) => {
    if (req.url !== '/' && req.url !== '/index.html') { res.writeHead(404).end('not found'); return; }
    res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'content-security-policy': "default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; connect-src 'none'" });
    res.end(html);
  }).listen(port, '127.0.0.1', () => {
    console.log(`VoucherEscrowV2 creation code: ${(bytecode.length - 2) / 2} bytes`);
    console.log(`keccak256: ${codeHash}`);
    console.log(`\nOpen http://127.0.0.1:${port} in the browser that has your wallet. Ctrl+C to stop.`);
  });
}
