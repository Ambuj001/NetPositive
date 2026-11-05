import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { randomBytes, createHash } from 'node:crypto'
const out = 'circuits/build'
mkdirSync(out, { recursive: true })
const snark = (...args) => execFileSync(process.execPath, ['node_modules/snarkjs/cli.js', ...args], { stdio: 'inherit' })
execFileSync('circom', ['circuits/vault.circom', '--r1cs', '--wasm', '--sym', '-l', 'node_modules', '-o', out], { stdio: 'inherit' })
// Small, local-only development ceremony. Never use these parameters with real assets.
snark('powersoftau', 'new', 'bn128', '12', `${out}/initial.ptau`)
snark('powersoftau', 'contribute', `${out}/initial.ptau`, `${out}/contributed.ptau`, '--name=LOCAL DEVELOPMENT ONLY', `-e=${randomBytes(48).toString('hex')}`)
snark('powersoftau', 'prepare', 'phase2', `${out}/contributed.ptau`, `${out}/dev.ptau`)
snark('groth16', 'setup', `${out}/vault.r1cs`, `${out}/dev.ptau`, `${out}/initial.zkey`)
snark('zkey', 'contribute', `${out}/initial.zkey`, `${out}/vault.zkey`, '--name=LOCAL DEVELOPMENT ONLY', `-e=${randomBytes(48).toString('hex')}`)
snark('zkey', 'verify', `${out}/vault.r1cs`, `${out}/dev.ptau`, `${out}/vault.zkey`)
snark('zkey', 'export', 'verificationkey', `${out}/vault.zkey`, `${out}/verification_key.json`)
snark('zkey', 'export', 'solidityverifier', `${out}/vault.zkey`, `${out}/Verifier.sol`)
const files = ['vault.r1cs', 'vault.zkey', 'verification_key.json', 'vault_js/vault.wasm', 'Verifier.sol']
writeFileSync(`${out}/manifest.json`, JSON.stringify({ security: 'LOCAL DEVELOPMENT SETUP — NOT FOR REAL ASSETS', compiler: execFileSync('circom', ['--version'], {encoding:'utf8'}).trim(), hashes: Object.fromEntries(files.map(f => [f, createHash('sha256').update(readFileSync(`${out}/${f}`)).digest('hex')])) }, null, 2))
const publicDir = 'apps/web/public/zk'
mkdirSync(publicDir, {recursive:true})
for (const [source,target] of [['vault_js/vault.wasm','vault.wasm'],['vault.zkey','vault.zkey']]) writeFileSync(`${publicDir}/${target}`, readFileSync(`${out}/${source}`))
console.info('Development circuit, prover and verifier built. Arc deployment remains disabled for these development parameters.')
