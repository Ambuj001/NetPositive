// Creates the server's secrets in Firebase Secret Manager without showing them to anyone.
//
//   npm run firebase:secrets            (after `npx firebase login` and `npx firebase use <project-id>`)
//
// JWT_SECRET, VOUCHER_ENC_KEY and the keeper key are generated on this machine and piped straight into Secret
// Manager; they are never printed or written to a file. Only the keeper's public ADDRESS is printed, so you can send
// it a little USDC on Arc for gas. A secret that already exists is left alone.
// WORLD_ID_SIGNING_KEY comes from the World developer portal: set it yourself with
//   npx firebase functions:secrets:set WORLD_ID_SIGNING_KEY
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

const fb = (args, input) => spawnSync('npx', ['firebase', ...args], { input, encoding: 'utf8' });
const exists = (name) => fb(['functions:secrets:get', name]).status === 0;
const set = (name, value) => {
  const r = fb(['functions:secrets:set', name, '--data-file', '-', '--force'], value);
  if (r.status !== 0) { console.error(`Could not set ${name}:\n${r.stderr || r.stdout}`); process.exit(1); }
};

const who = fb(['use']);
if (who.status !== 0) { console.error('Run `npx firebase login` and `npx firebase use <project-id>` first.'); process.exit(1); }
console.log(`Firebase project: ${who.stdout.trim().split('\n').pop()}\n`);

for (const [name, make] of [['JWT_SECRET', () => crypto.randomBytes(48).toString('hex')], ['VOUCHER_ENC_KEY', () => crypto.randomBytes(32).toString('hex')]]) {
  if (exists(name)) { console.log(`${name}: already set, left as it is`); continue; }
  set(name, make());
  console.log(`${name}: created`);
}

if (exists('ESCROW_KEEPER_PRIVATE_KEY')) {
  console.log('ESCROW_KEEPER_PRIVATE_KEY: already set, left as it is (its address was shown when it was created)');
} else {
  const key = generatePrivateKey();
  set('ESCROW_KEEPER_PRIVATE_KEY', key);
  console.log('ESCROW_KEEPER_PRIVATE_KEY: created');
  console.log(`\nKeeper address: ${privateKeyToAccount(key).address}`);
  console.log('Send about 1 USDC to this address on Arc mainnet. It only pays gas for timeouts; it has no power in the contract.');
}
console.log(`\nWORLD_ID_SIGNING_KEY: ${exists('WORLD_ID_SIGNING_KEY') ? 'already set' : 'NOT set yet. Run: npx firebase functions:secrets:set WORLD_ID_SIGNING_KEY'}`);
