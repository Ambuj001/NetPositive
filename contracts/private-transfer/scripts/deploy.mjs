// Deploys KeyRegistry + CodeMailbox to Arc testnet from a funded wallet with a plain contract-creation transaction
// (the same way VoucherEscrow was deployed: Foundry/RPC, one wallet, no proxy), then verifies the result on-chain.
//
// CHECK ONLY (default, read-only, sends nothing):
//   node scripts/deploy.mjs
//   (optional) DEPLOYER_PK=<key> to also check the deployer balance
// DEPLOY (sends 2 transactions, costs a little testnet gas):
//   DEPLOYER_PK=<funded key> CONFIRM_DEPLOY=<escrow address> node scripts/deploy.mjs
//
// SAFETY: the key is read only from DEPLOYER_PK, never printed or written. A real deploy requires CONFIRM_DEPLOY to equal the
// escrow address and refuses unless the chain is Arc testnet (5042002) and the escrow looks like the real VoucherEscrow.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createPublicClient, createWalletClient, custom, defineChain, formatUnits, getAddress, hashTypedData, http, parseAbi, sha256 } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const RPC = process.env.ARC_RPC_URL || 'https://rpc.testnet.arc.io';
const CHAIN_ID = 5042002;
const ARC_USDC = '0x3600000000000000000000000000000000000000';
const ESCROW = getAddress(process.env.ESCROW_ADDRESS || '0x96456Edda0DEAd356EB8c97c2865FEBb693E0888');
const DEPLOY = Boolean(process.env.CONFIRM_DEPLOY);
const art = (n) => JSON.parse(fs.readFileSync(path.join(root, 'build', `${n}.json`), 'utf8'));

const chain = defineChain({ id: CHAIN_ID, name: 'Arc Testnet', nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, rpcUrls: { default: { http: [RPC] } } });
// The public Arc RPC rejects bursts ("Request exceeds defined limit"): space requests out and retry those rejections, so a
// throttle in the middle of a deploy cannot leave it half-done.
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
const fail = (m) => { console.error(`STOP: ${m}`); process.exit(2); };
const ok = (m) => console.log(`  ok   ${m}`);

console.log(`\nMode: ${DEPLOY ? 'DEPLOY (transactions will be sent)' : 'CHECK ONLY (read-only)'}   RPC: ${RPC}\n`);
if ((await pub.getChainId()) !== CHAIN_ID) fail(`RPC is not chain ${CHAIN_ID}`);
ok(`chain id ${CHAIN_ID} (Arc testnet)`);

const escrowAbi = parseAbi(['function usdc() view returns (address)', 'function operator() view returns (address)', 'function feeBps() view returns (uint256)']);
if (!((await pub.getCode({ address: ESCROW }))?.length > 2)) fail('no contract at the escrow address');
const usdc = await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'usdc' }).catch(() => null);
if (!usdc || usdc.toLowerCase() !== ARC_USDC) fail('escrow does not look like the deployed VoucherEscrow (usdc() mismatch)');
ok(`escrow ${ESCROW} is VoucherEscrow (usdc = Arc USDC, operator ${await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'operator' })}, feeBps ${await pub.readContract({ address: ESCROW, abi: escrowAbi, functionName: 'feeBps' })})`);

let account = null;
if (process.env.DEPLOYER_PK) {
  account = privateKeyToAccount(`0x${process.env.DEPLOYER_PK.replace(/^0x/, '')}`);
  const bal = await pub.getBalance({ address: account.address });
  ok(`deployer ${account.address} holds ${formatUnits(bal, 18)} USDC (native)`);
  if (bal < 10n ** 17n) fail('deployer has less than 0.1 USDC for gas');
}
if (!DEPLOY) { console.log('\nCheck only: nothing sent. Re-run with DEPLOYER_PK and CONFIRM_DEPLOY=<escrow address> to deploy.'); process.exit(0); }
if (!account) fail('DEPLOYER_PK is required to deploy');
if (process.env.CONFIRM_DEPLOY.toLowerCase() !== ESCROW.toLowerCase()) fail('CONFIRM_DEPLOY must equal the escrow address');

const wallet = createWalletClient({ account, chain, transport });
async function deploy(name, args) {
  const { abi, bytecode } = art(name);
  const hash = await wallet.deployContract({ abi, bytecode, args });
  const r = await pub.waitForTransactionReceipt({ hash, timeout: 120_000 });
  if (r.status !== 'success' || !r.contractAddress) fail(`${name} deployment failed (${hash})`);
  console.log(`  sent ${name} -> ${r.contractAddress}  (tx ${hash}, block ${r.blockNumber}, gas ${r.gasUsed})`);
  return { address: getAddress(r.contractAddress), abi, hash, block: Number(r.blockNumber), gasUsed: Number(r.gasUsed) };
}
console.log('Deploying:');
const registry = await deploy('KeyRegistry', []);
const mailbox = await deploy('CodeMailbox', [ESCROW, registry.address]);

console.log('\nVerifying on-chain:');
const regCode = (await pub.getCode({ address: registry.address })).toLowerCase();
if (regCode !== art('KeyRegistry').deployedBytecode.toLowerCase()) fail('KeyRegistry on-chain code differs from the compiled code');
ok('KeyRegistry on-chain bytecode equals the compiled bytecode');
if (getAddress(await pub.readContract({ address: mailbox.address, abi: mailbox.abi, functionName: 'escrow' })) !== ESCROW) fail('mailbox.escrow() mismatch');
if (getAddress(await pub.readContract({ address: mailbox.address, abi: mailbox.abi, functionName: 'registry' })) !== registry.address) fail('mailbox.registry() mismatch');
ok('CodeMailbox points at the escrow and the registry');
const message = { escrowId: `0x${'ab'.repeat(32)}`, fulfiller: account.address, validUntil: 1234567890n };
const local = hashTypedData({
  domain: { name: 'NetPositiveCodeMailbox', version: '1', chainId: CHAIN_ID, verifyingContract: mailbox.address },
  types: { Ready: [{ name: 'escrowId', type: 'bytes32' }, { name: 'fulfiller', type: 'address' }, { name: 'validUntil', type: 'uint64' }] },
  primaryType: 'Ready', message,
});
const onchain = await pub.readContract({ address: mailbox.address, abi: mailbox.abi, functionName: 'readyDigest', args: [message.escrowId, message.fulfiller, message.validUntil] });
if (onchain !== local) fail('on-chain Ready digest differs from the locally computed EIP-712 digest');
ok('on-chain EIP-712 digest equals the digest wallets will sign (chain id and contract address bound)');
const pk = `0x${'11'.repeat(32)}`;
const kid = await pub.readContract({ address: registry.address, abi: registry.abi, functionName: 'keyId', args: [pk] });
if (kid !== `0x${sha256(pk).slice(2, 18)}`) fail('on-chain keyId differs from sha256-based id');
ok('on-chain keyId equals sha256(publicKey)[0..8] (the sealed-box library uses the same id)');

const out = {
  network: 'Arc testnet', chainId: CHAIN_ID, escrow: ESCROW,
  keyRegistry: { address: registry.address, txHash: registry.hash, block: registry.block, gasUsed: registry.gasUsed },
  codeMailbox: { address: mailbox.address, txHash: mailbox.hash, block: mailbox.block, gasUsed: mailbox.gasUsed },
  deployer: account.address, compiler: { solc: '0.8.24', evmVersion: 'paris', optimizerRuns: 200 }, deployedAt: new Date().toISOString(),
};
fs.mkdirSync(path.join(root, 'deployments'), { recursive: true });
fs.writeFileSync(path.join(root, 'deployments', 'arc-testnet.json'), `${JSON.stringify(out, null, 2)}\n`);
console.log('\nDeployed and verified. Addresses saved to contracts/deployments/arc-testnet.json');
