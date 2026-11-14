// Pure encoding and validation for deploying VoucherEscrowV2 from a browser wallet.
// Shared by the page (inlined by serve.mjs) and by the node test, so what is tested is what the wallet signs.

export const NETWORKS = {
  mainnet: { id: 5042, hex: '0x13b2', name: 'Arc', rpc: 'https://rpc.mainnet.arc.io', explorer: 'https://explorer.arc.io' },
  testnet: { id: 5042002, hex: '0x4cef52', name: 'Arc Testnet', rpc: 'https://rpc.testnet.arc.io', explorer: 'https://testnet.arcscan.app' },
};
/** USDC's ERC-20 address, the same on Arc mainnet and testnet. 6 decimals. */
export const ARC_USDC = '0x3600000000000000000000000000000000000000';

// Limits copied from the contract, so a bad value is caught before the wallet is asked to sign.
export const LIMITS = { maxFeeBps: 500, minReview: 30 * 60, maxReview: 7 * 86400, minFulfill: 15 * 60, maxFulfill: 7 * 86400 };

export const SELECTOR_SET_TOKEN = '0x33fdba48'; // setToken(address,bool,uint128,uint128,uint256,uint128)

const isAddress = (a) => typeof a === 'string' && /^0x[0-9a-fA-F]{40}$/.test(a);
const ZERO = '0x' + '0'.repeat(40);

export function word(v) {
  const n = BigInt(v);
  if (n < 0n) throw new Error('negative value');
  const h = n.toString(16);
  if (h.length > 64) throw new Error('value too large');
  return h.padStart(64, '0');
}
export function addressWord(a) {
  if (!isAddress(a)) throw new Error(`not an address: ${a}`);
  return a.slice(2).toLowerCase().padStart(64, '0');
}

/** "1", "250", "0.5" -> 6-decimal base units. */
export function usdc(text) {
  const m = /^(\d+)(?:\.(\d{1,6}))?$/.exec(String(text).trim());
  if (!m) throw new Error(`not a USDC amount: ${text}`);
  return BigInt(m[1]) * 1_000_000n + BigInt((m[2] ?? '').padEnd(6, '0') || '0');
}

/**
 * Check the deployment settings the way the contract's constructor and the launch rules will.
 * Returns a list of problems in plain words; empty means good to sign.
 */
export function problems(p) {
  const out = [];
  const roles = { owner: p.owner, arbiter: p.arbiter, guardian: p.guardian, treasury: p.treasury, reserve: p.reserve };
  for (const [name, a] of Object.entries(roles)) {
    if (!isAddress(a)) out.push(`${name}: not a wallet address`);
    else if (a.toLowerCase() === ZERO) out.push(`${name}: cannot be the zero address`);
  }
  const same = (a, b) => isAddress(a) && isAddress(b) && a.toLowerCase() === b.toLowerCase();
  if (same(p.arbiter, p.owner)) out.push('arbiter must be a different wallet from the owner');
  if (same(p.guardian, p.owner)) out.push('guardian must be a different wallet from the owner');
  if (same(p.arbiter, p.guardian)) out.push('arbiter and guardian should be different wallets');
  const int = (v) => Number.isInteger(v) && v >= 0;
  if (!int(p.feeBps) || p.feeBps > LIMITS.maxFeeBps) out.push(`fee must be 0 to ${LIMITS.maxFeeBps / 100}%`);
  if (!int(p.reserveShareBps) || p.reserveShareBps > 10_000) out.push('reserve share must be 0 to 100%');
  if (!int(p.reviewWindow) || p.reviewWindow < LIMITS.minReview || p.reviewWindow > LIMITS.maxReview) out.push('review window must be 30 minutes to 7 days');
  if (!int(p.fulfillWindow) || p.fulfillWindow < LIMITS.minFulfill || p.fulfillWindow > LIMITS.maxFulfill) out.push('fulfil window must be 15 minutes to 7 days');
  try {
    const min = usdc(p.minUsdc), max = usdc(p.maxUsdc), cap = usdc(p.capUsdc);
    usdc(p.bondUsdc);
    if (max === 0n) out.push('largest order must be above 0');
    if (min > max) out.push('smallest order is larger than the largest order');
    if (cap < max) out.push('total cap is smaller than the largest single order');
  } catch (e) {
    out.push(e.message);
  }
  return out;
}

/** Constructor arguments, in the contract's order: nine static words. */
export function constructorArgs(p) {
  return [p.owner, p.arbiter, p.guardian, p.treasury, p.reserve].map(addressWord).join('') + [p.feeBps, p.reserveShareBps, p.reviewWindow, p.fulfillWindow].map(word).join('');
}

/** The data of the deployment transaction: creation bytecode followed by the constructor arguments. */
export function creationData(bytecode, p) {
  const code = bytecode.replace(/^0x/i, '');
  if (!/^[0-9a-fA-F]+$/.test(code) || code.length % 2) throw new Error('bytecode is not hex');
  return '0x' + code + constructorArgs(p);
}

/** setToken(USDC, true, min, max, cap, disputeBond): the call that opens the contract for deposits. */
export function setTokenData(p) {
  return SELECTOR_SET_TOKEN + addressWord(ARC_USDC) + word(1) + word(usdc(p.minUsdc)) + word(usdc(p.maxUsdc)) + word(usdc(p.capUsdc)) + word(usdc(p.bondUsdc));
}

// Read-back calls, to confirm on-chain that the deployed contract holds exactly what was reviewed.
export const READS = {
  owner: '0x8da5cb5b',
  arbiter: '0xfe25e00a',
  guardian: '0x452a9320',
  treasury: '0x61d027b3',
  reserve: '0xcd3293de',
  feeBps: '0x24a9d853',
  reserveShareBps: '0xee12628e',
  reviewWindow: '0x9ca4218f',
  fulfillWindow: '0x118a7796',
};
export const tokenConfigCall = () => '0xfe136c4e' + addressWord(ARC_USDC); // tokenConfig(address)

export const asAddress = (hex) => '0x' + hex.replace(/^0x/, '').slice(24, 64).toLowerCase();
export const asNumber = (hex) => Number(BigInt('0x' + (hex.replace(/^0x/, '').slice(0, 64) || '0')));

/** Compare what the chain returned with what was reviewed. Returns a list of mismatches; empty means verified. */
export function mismatches(p, onchain) {
  const out = [];
  const addr = (k) => { if (asAddress(onchain[k]) !== p[k].toLowerCase()) out.push(`${k} on-chain is ${asAddress(onchain[k])}, expected ${p[k]}`); };
  const num = (k) => { if (asNumber(onchain[k]) !== p[k]) out.push(`${k} on-chain is ${asNumber(onchain[k])}, expected ${p[k]}`); };
  ['owner', 'arbiter', 'guardian', 'treasury', 'reserve'].forEach(addr);
  ['feeBps', 'reserveShareBps', 'reviewWindow', 'fulfillWindow'].forEach(num);
  return out;
}

/** tokenConfig(USDC) returns (enabled, minAmount, maxAmount, cap, disputeBond). */
export function tokenMismatches(p, hex) {
  const h = hex.replace(/^0x/, '');
  const w = (i) => BigInt('0x' + (h.slice(i * 64, i * 64 + 64) || '0'));
  const out = [];
  if (w(0) !== 1n) out.push('USDC is not enabled');
  const want = [usdc(p.minUsdc), usdc(p.maxUsdc), usdc(p.capUsdc), usdc(p.bondUsdc)];
  ['smallest order', 'largest order', 'total cap', 'dispute stake'].forEach((name, i) => { if (w(i + 1) !== want[i]) out.push(`${name} on-chain is ${w(i + 1)}, expected ${want[i]}`); });
  return out;
}
