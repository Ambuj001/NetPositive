// LIVE end-to-end test of KeyRegistry + CodeMailbox + the deployed VoucherEscrow on Arc testnet.
//
// CHECK ONLY (default, read-only):  node scripts/live-e2e.mjs
// REAL RUN (sends ~8 transactions, deposits 0.10 USDC then refunds it, ~0.1 USDC of gas in total):
//   OPERATOR_PK=<escrow operator key> CONFIRM_LIVE=<CodeMailbox address> node scripts/live-e2e.mjs
//
// Actors: the operator wallet plays the requester (Shivam) AND is the escrow operator (as in the earlier chain test);
// a throwaway wallet plays the fulfiller (Saad) and is refunded of its leftover gas money at the end.
// SAFETY: keys only from the environment, never printed or written. Needs CONFIRM_LIVE to equal the mailbox address.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, custom, defineChain, formatUnits, getAddress, hexToString, http, keccak256, parseAbi, parseAbiItem, stringToHex, toHex } from 'viem';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';
import * as V from '../../../backend/vault-sdk/index.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dep = JSON.parse(fs.readFileSync(path.join(root, 'deployments', 'arc-testnet.json'), 'utf8'));
const art = (n) => JSON.parse(fs.readFileSync(path.join(root, 'build', `${n}.json`), 'utf8'));
const RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io';
const CHAIN_ID = 5042002;
const USDC = '0x3600000000000000000000000000000000000000';
const ESCROW = getAddress(dep.escrow), REGISTRY = getAddress(dep.keyRegistry.address), MAILBOX = getAddress(dep.codeMailbox.address);
const REAL = Boolean(process.env.CONFIRM_LIVE);
const AMOUNT = 100_000n; // 0.10 USDC (6 decimals)
const CODE = { code: '9000111122223333', pin: '424242' }; // synthetic, not a real voucher

const chain = defineChain({ id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
// The public Arc RPC rejects bursts ("Request exceeds defined limit"), so space requests out and retry those rejections.
const rawHttp = http(RPC, { timeout: 30000, retryCount: 0 })({ chain, retryCount: 0 });
let lastCall = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const transport = custom({
  async request(args) {
    for (let attempt = 0; ; attempt++) {
      const wait = lastCall + 350 - Date.now();
      if (wait > 0) await sleep(wait);
      lastCall = Date.now();
      try { return await rawHttp.request(args); }
      catch (e) {
        const msg = String(e.shortMessage || e.message);
        if (attempt < 10 && /exceeds defined limit|rate|429|timeout|timed out|fetch failed|too many/i.test(msg)) { await sleep(800 * (attempt + 1)); continue; }
        throw e;
      }
    }
  },
});
const pub = createPublicClient({ chain, transport });
const escrowAbi = parseAbi(['function escrows(bytes32) view returns (address depositor, uint256 amount, uint8 status)', 'function operator() view returns (address)', 'function deposit(bytes32 id, uint256 amount)', 'function refund(bytes32 id)']);
const erc20 = parseAbi(['function approve(address,uint256) returns (bool)', 'function balanceOf(address) view returns (uint256)']);
const registryAbi = art('KeyRegistry').abi, mailboxAbi = art('CodeMailbox').abi;
const deliveredEvent = parseAbiItem('event Delivered(bytes32 indexed escrowId, address indexed fulfiller, address indexed recipient, bytes8 keyId, bytes32 ciphertextHash, uint64 deliveredAt, bytes ciphertext)');

const results = [];
async function check(name, fn) {
  try { const v = await fn(); results.push(true); console.log(`  PASS  ${name}`); return v; }
  catch (e) { results.push(false); console.log(`  FAIL  ${name}\n        ${String(e.shortMessage || e.message).replace(/\s+/g, ' ').slice(0, 300)}`); }
}
const txs = [];

console.log(`\nMode: ${REAL ? 'REAL ARC TESTNET RUN (transactions are sent)' : 'CHECK ONLY (read-only)'}\n`);
await check('chain is Arc testnet and all three contracts have code', async () => {
  assert.equal(await pub.getChainId(), CHAIN_ID);
  for (const a of [ESCROW, REGISTRY, MAILBOX]) assert.ok((await pub.getCode({ address: a }))?.length > 2, `no code at ${a}`);
});
const operatorAddr = getAddress(await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'operator' }));
if (!REAL) { console.log(`\nCheck only. Escrow operator is ${operatorAddr}. Re-run with OPERATOR_PK and CONFIRM_LIVE=${MAILBOX} for the live run.`); process.exit(results.every(Boolean) ? 0 : 1); }
if (process.env.CONFIRM_LIVE.toLowerCase() !== MAILBOX.toLowerCase()) { console.error('STOP: CONFIRM_LIVE must equal the CodeMailbox address'); process.exit(2); }
if (!process.env.OPERATOR_PK) { console.error('STOP: OPERATOR_PK is required'); process.exit(2); }

const requester = privateKeyToAccount(`0x${process.env.OPERATOR_PK.replace(/^0x/, '')}`);
if (requester.address !== operatorAddr) { console.error('STOP: the key is not the escrow operator'); process.exit(2); }
const fulfiller = privateKeyToAccount(generatePrivateKey()); // throwaway
const wc = (account) => createWalletClient({ account, chain, transport });
async function send(account, label, params) {
  const hash = await wc(account).writeContract(params);
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  assert.equal(r.status, 'success', `${label} reverted (${hash})`);
  txs.push({ label, hash, block: Number(r.blockNumber), gas: Number(r.gasUsed) });
  return r;
}

const requestId = `live-${Date.now()}`;
const escrowId = keccak256(stringToHex(requestId));
const startBal = await pub.getBalance({ address: requester.address });
console.log(`requestId ${requestId}\nescrowId  ${escrowId}\nrequester ${requester.address} (operator)\nfulfiller ${fulfiller.address} (throwaway)\n`);

let keys, deliverReceipt, ciphertextHex;
await check('requester derives the vault key from a wallet signature (deterministic) and registers it in KeyRegistry', async () => {
  const s1 = await requester.signMessage({ message: V.KEY_MESSAGE });
  V.assertDeterministicSignature(s1, await requester.signMessage({ message: V.KEY_MESSAGE }));
  keys = V.deriveVaultKeys(s1);
  await send(requester, 'KeyRegistry.setKey', { address: REGISTRY, abi: registryAbi, functionName: 'setKey', args: [`0x${keys.publicKeyHex}`] });
  const [pk] = await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'keyOf', args: [requester.address] });
  assert.equal(pk, `0x${keys.publicKeyHex}`);
  assert.equal(await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'currentKeyId', args: [requester.address] }), `0x${V.keyId(keys.publicKeyHex)}`);
});
await check('requester locks 0.10 USDC in the real escrow (approve + deposit)', async () => {
  await send(requester, 'USDC.approve', { address: USDC, abi: erc20, functionName: 'approve', args: [ESCROW, AMOUNT] });
  await send(requester, 'Escrow.deposit', { address: ESCROW, abi: escrowAbi, functionName: 'deposit', args: [escrowId, AMOUNT] });
  const [depositor, amount, status] = await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'escrows', args: [escrowId] });
  assert.equal(depositor, requester.address); assert.equal(amount, AMOUNT); assert.equal(status, 1);
});
let sig, validUntil;
await check('requester signs the gasless Ready permit for the fulfiller (EIP-712, Arc chain id)', async () => {
  validUntil = BigInt((await pub.getBlock()).timestamp) + 600n;
  sig = await requester.signTypedData({
    domain: { name: 'NetPositiveCodeMailbox', version: '1', chainId: CHAIN_ID, verifyingContract: MAILBOX },
    types: { Ready: [{ name: 'escrowId', type: 'bytes32' }, { name: 'fulfiller', type: 'address' }, { name: 'validUntil', type: 'uint64' }] },
    primaryType: 'Ready', message: { escrowId, fulfiller: fulfiller.address, validUntil },
  });
});
await check('the fulfiller (throwaway) is given a little gas money', async () => {
  const hash = await wc(requester).sendTransaction({ to: fulfiller.address, value: 20_000_000_000_000_000n }); // 0.02 USDC (native, 18 decimals)
  await pub.waitForTransactionReceipt({ hash }); txs.push({ label: 'gas money to fulfiller', hash });
});
await check('the fulfiller reads the requester key from the registry, seals the code to it, and calls deliver() on Arc', async () => {
  const [pk] = await pub.readContract({ address: REGISTRY, abi: registryAbi, functionName: 'keyOf', args: [requester.address] });
  const pkHex = pk.slice(2);
  const env = V.seal(CODE, [pkHex], V.voucherAad(requestId, requester.address, fulfiller.address));
  ciphertextHex = toHex(new TextEncoder().encode(JSON.stringify(env)));
  deliverReceipt = await send(fulfiller, 'CodeMailbox.deliver', { address: MAILBOX, abi: mailboxAbi, functionName: 'deliver', args: [escrowId, `0x${V.keyId(pkHex)}`, ciphertextHex, validUntil, sig] });
});
await check('on-chain record: stored hash, delivery time = block time, ciphertext matches', async () => {
  const [f, r, at, kid, h] = await pub.readContract({ address: MAILBOX, abi: mailboxAbi, functionName: 'deliveries', args: [escrowId] });
  const block = await pub.getBlock({ blockNumber: deliverReceipt.blockNumber });
  assert.equal(f, fulfiller.address); assert.equal(r, requester.address);
  assert.equal(at, block.timestamp, 'deliveredAt is the block timestamp'); assert.equal(h, keccak256(ciphertextHex));
  assert.ok(await pub.readContract({ address: MAILBOX, abi: mailboxAbi, functionName: 'matches', args: [escrowId, ciphertextHex] }));
});
await check('the requester finds the Delivered event through the RPC, decrypts it locally, and gets the code', async () => {
  const logs = await pub.getLogs({ address: MAILBOX, event: deliveredEvent, args: { escrowId }, fromBlock: deliverReceipt.blockNumber, toBlock: deliverReceipt.blockNumber });
  assert.equal(logs.length, 1);
  const env = JSON.parse(hexToString(logs[0].args.ciphertext));
  assert.deepEqual(V.open(env, keys.privateKey, V.voucherAad(requestId, requester.address, fulfiller.address)), CODE);
  assert.ok(!hexToString(logs[0].args.ciphertext).includes(CODE.code), 'plaintext is not in the public event');
});
await check('negative (simulated on Arc, no gas): a second delivery is refused', async () => {
  await assert.rejects(pub.simulateContract({ account: fulfiller, address: MAILBOX, abi: mailboxAbi, functionName: 'deliver', args: [escrowId, `0x${V.keyId(keys.publicKeyHex)}`, ciphertextHex, validUntil, sig] }), /AlreadyDelivered/);
});
await check('negative (simulated on Arc, no gas): the permit cannot be used by another wallet', async () => {
  const other = privateKeyToAccount(generatePrivateKey());
  const id2 = keccak256(stringToHex(`${requestId}-other`));
  await assert.rejects(pub.simulateContract({ account: other, address: MAILBOX, abi: mailboxAbi, functionName: 'deliver', args: [id2, `0x${V.keyId(keys.publicKeyHex)}`, ciphertextHex, validUntil, sig] }), /EscrowNotFunded|BadPermit/);
});
await check('cleanup: operator refunds the escrow, requester gets the 0.10 USDC back', async () => {
  const before = await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [requester.address] });
  await send(requester, 'Escrow.refund', { address: ESCROW, abi: escrowAbi, functionName: 'refund', args: [escrowId] });
  const [, , status] = await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'escrows', args: [escrowId] });
  assert.equal(status, 3);
  assert.ok((await pub.readContract({ address: USDC, abi: erc20, functionName: 'balanceOf', args: [requester.address] })) >= before + AMOUNT - 100_000n);
});
await check('cleanup: the throwaway fulfiller returns its leftover gas money (best effort)', async () => {
  const bal = await pub.getBalance({ address: fulfiller.address });
  const keep = 4_000_000_000_000_000n; // leave room for the transfer fee
  if (bal > keep * 2n) { const hash = await wc(fulfiller).sendTransaction({ to: requester.address, value: bal - keep }); await pub.waitForTransactionReceipt({ hash }); }
});

const endBal = await pub.getBalance({ address: requester.address });
console.log(`\nTransactions:\n${txs.map((t) => `  ${t.label.padEnd(26)} ${t.hash}${t.gas ? `  gas ${t.gas}` : ''}`).join('\n')}`);
console.log(`\nOperator balance: ${formatUnits(startBal, 18)} -> ${formatUnits(endBal, 18)} USDC (net cost ${formatUnits(startBal - endBal, 18)})`);
const failed = results.filter((r) => !r).length;
console.log(`\n==== ${results.length - failed}/${results.length} checks passed ====`);
process.exitCode = failed ? 1 : 0;
