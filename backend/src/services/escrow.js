import { createPublicClient, createWalletClient, defineChain, encodeAbiParameters, http, keccak256, parseAbi, stringToHex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

/**
 * VoucherEscrowV2 (contracts/src/VoucherEscrowV2.sol).
 *
 * This server holds no key that can move an escrow to an address of its choosing. What it does:
 *   - reads escrow state, to check what the two parties did from their own wallets;
 *   - sends the calls anyone may send (claim, refundExpired) with the keeper key, which has no role in the contract;
 *   - sends `resolve` on a disputed escrow with the arbiter key, when one is configured.
 * The depositor's own steps (deposit, release, cancel, dispute) and the fulfiller's (accept, markDelivered) are
 * transactions from their wallets; the routes verify them here afterwards.
 */
export const ESCROW_ABI = parseAbi([
  'struct Escrow { address depositor; uint64 openUntil; uint32 epoch; address fulfiller; uint64 deadline; uint8 status; address token; uint32 reviewWindow; uint32 fulfillWindow; uint128 amount; uint128 fee; uint128 bond; }',
  'function getEscrow(bytes32 id) view returns (Escrow)',
  'function escrows(bytes32 id) view returns (address depositor, uint256 amount, uint8 status)',
  'function escrowId(address depositor, bytes32 ref) pure returns (bytes32)',
  'function quoteFee(uint256 amount) view returns (uint256)',
  'function arbiter() view returns (address)',
  'function feeBps() view returns (uint16)',
  'function reviewWindow() view returns (uint32)',
  'function fulfillWindow() view returns (uint32)',
  'function paused() view returns (bool)',
  'function totalLocked(address token) view returns (uint256)',
  'function tokenConfig(address token) view returns (bool enabled, uint128 minAmount, uint128 maxAmount, uint256 cap, uint128 disputeBond)',
  'function deposit(bytes32 ref, address token, uint256 amount, uint64 ttl, uint256 maxTotal) returns (bytes32)',
  'function assign(bytes32 id, address fulfiller)',
  'function accept(bytes32 id, uint64 validUntil, bytes signature)',
  'function unassign(bytes32 id)',
  'function markDelivered(bytes32 id, bytes32 evidence)',
  'function release(bytes32 id)',
  'function claim(bytes32 id)',
  'function cancel(bytes32 id)',
  'function refundExpired(bytes32 id)',
  'function dispute(bytes32 id, bytes32 reason)',
  'function concede(bytes32 id)',
  'function resolve(bytes32 id, uint256 toFulfiller)',
  'function refundStaleDispute(bytes32 id)',
]);

export const STATUS = { None: 0, Funded: 1, Delivered: 2, Disputed: 3, Released: 4, Refunded: 5, Resolved: 6 };
const STATUS_NAMES = ['none', 'funded', 'delivered', 'disputed', 'released', 'refunded', 'resolved'];
const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000';

export const arc = defineChain({
  id: config.ARC_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, // Arc gas token; ERC-20 USDC interface uses 6
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
});

export const publicClient = createPublicClient({ chain: arc, transport: http(config.ARC_RPC_URL) });

const walletFor = (key) => (key ? createWalletClient({ account: privateKeyToAccount(key), chain: arc, transport: http(config.ARC_RPC_URL) }) : null);
const keeper = walletFor(config.ESCROW_KEEPER_PRIVATE_KEY);
const arbiter = walletFor(config.ESCROW_ARBITER_PRIVATE_KEY);

export const isMock = config.ESCROW_MODE === 'mock';
/** Mock mode only: names of operations that should fail ('release', 'refund', 'verifyDeposit'), to test failure paths. */
export const mockFaults = new Set();
if (isMock) console.warn('[escrow] ESCROW_MODE=mock: on-chain checks and payouts are SIMULATED.');

/** The `ref` the depositor passes to deposit(): one per order. */
export const escrowRefFor = (requestId) => keccak256(stringToHex(requestId));

/** The on-chain escrow id: keccak256(abi.encode(depositor, ref)). Nobody but the depositor can occupy it. */
export const escrowIdOf = (depositor, ref) =>
  keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'bytes32' }], [getAddress(depositor), ref]));

/** The chain's clock (unix seconds). Deadlines are compared against block time, not this server's clock. */
export async function chainNow() {
  return Number((await publicClient.getBlock({ blockTag: 'latest' })).timestamp);
}

/** Fee the contract will pull on top of `amountBaseUnits` for a deposit made now. */
export async function quoteFee(amountBaseUnits) {
  const amount = BigInt(amountBaseUnits);
  if (isMock) return (amount * BigInt(config.ESCROW_MOCK_FEE_BPS)) / 10_000n;
  return publicClient.readContract({ address: config.ESCROW_CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'quoteFee', args: [amount] });
}

let termsCache = null;

/**
 * What the contract charges and allows for a deposit made now. Read from the chain (cached for 30 seconds), so the
 * app never shows a fee or limit the contract would not honour. In mock mode the numbers are stand-ins.
 */
export async function escrowTerms() {
  const base = { version: 2, mode: config.ESCROW_MODE, chainId: config.ARC_CHAIN_ID, token: config.USDC_ADDRESS, orderTtlSeconds: config.ESCROW_ORDER_TTL_SECONDS };
  if (isMock) {
    return { ...base, contract: null, feeBps: config.ESCROW_MOCK_FEE_BPS, disputeBondBaseUnits: '0', minBaseUnits: '1', maxBaseUnits: '1000000000000', capBaseUnits: '1000000000000', lockedBaseUnits: '0', reviewWindowSeconds: config.REVIEW_WINDOW_MINUTES * 60, fulfillWindowSeconds: config.FULFIL_WINDOW_MINUTES * 60, paused: false };
  }
  if (termsCache && termsCache.at > Date.now() - 30_000) return termsCache.value;
  const read = (functionName, args = []) => publicClient.readContract({ address: config.ESCROW_CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName, args });
  const [feeBps, reviewWindow, fulfillWindow, paused, locked, token] = await Promise.all([
    read('feeBps'), read('reviewWindow'), read('fulfillWindow'), read('paused'), read('totalLocked', [config.USDC_ADDRESS]), read('tokenConfig', [config.USDC_ADDRESS]),
  ]);
  const [enabled, minAmount, maxAmount, cap, disputeBond] = token;
  const value = {
    ...base,
    contract: config.ESCROW_CONTRACT_ADDRESS,
    feeBps: Number(feeBps),
    disputeBondBaseUnits: disputeBond.toString(),
    minBaseUnits: minAmount.toString(),
    maxBaseUnits: maxAmount.toString(),
    capBaseUnits: cap.toString(),
    lockedBaseUnits: locked.toString(),
    reviewWindowSeconds: Number(reviewWindow),
    fulfillWindowSeconds: Number(fulfillWindow),
    paused: Boolean(paused) || !enabled, // a disabled token takes no deposits either
  };
  termsCache = { at: Date.now(), value };
  return value;
}

/**
 * The escrow as the chain has it, or null in mock mode.
 * `status` is one of none | funded | delivered | disputed | released | refunded | resolved. Times are unix seconds.
 */
export async function readEscrow(id) {
  if (isMock) return null;
  const e = await publicClient.readContract({ address: config.ESCROW_CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName: 'getEscrow', args: [id] });
  return {
    status: STATUS_NAMES[e.status] ?? 'unknown',
    depositor: e.depositor.toLowerCase(),
    fulfiller: e.fulfiller === ZERO_ADDRESS ? null : e.fulfiller.toLowerCase(),
    token: e.token.toLowerCase(),
    amount: e.amount,
    fee: e.fee,
    bond: e.bond, // dispute stake the depositor must approve and lock to dispute
    epoch: Number(e.epoch),
    openUntil: Number(e.openUntil),
    deadline: Number(e.deadline),
  };
}

/**
 * Confirm the depositor locked exactly the expected amount of USDC under this escrow id.
 * We check contract state (not just the receipt) so a spoofed or unrelated transaction cannot pass.
 */
export async function verifyDeposit({ id, depositor, amountBaseUnits, txHash }) {
  if (isMock) {
    if (mockFaults.has('verifyDeposit')) throw new HttpError(400, 'escrow_not_funded', 'Escrow is not in Funded state');
    return { ok: true };
  }

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt || receipt.status !== 'success') {
    throw new HttpError(400, 'tx_not_confirmed', 'Escrow transaction not found or failed');
  }
  if (getAddress(receipt.to ?? ZERO_ADDRESS) !== getAddress(config.ESCROW_CONTRACT_ADDRESS)) {
    throw new HttpError(400, 'tx_wrong_contract', 'Transaction was not sent to the escrow contract');
  }

  const e = await readEscrow(id);
  if (e.status !== 'funded') throw new HttpError(400, 'escrow_not_funded', 'Escrow is not in Funded state');
  if (e.depositor !== depositor.toLowerCase()) throw new HttpError(400, 'escrow_wrong_depositor', 'Escrow depositor does not match requester');
  if (e.token !== config.USDC_ADDRESS.toLowerCase()) throw new HttpError(400, 'escrow_wrong_token', 'Escrow holds a different token than USDC');
  if (e.amount !== BigInt(amountBaseUnits)) {
    throw new HttpError(400, 'escrow_wrong_amount', `Escrow holds ${e.amount}, expected ${amountBaseUnits}`);
  }
  return { ok: true };
}

/** Mock mode only: every payout that would have gone on-chain, so tests can assert who was paid. */
export const mockCalls = [];

function mockSend(functionName, args) {
  if (mockFaults.has(functionName)) throw new Error(`mock ${functionName} failure`);
  mockCalls.push({ functionName, args });
  return `0xmock${Date.now().toString(16)}${mockCalls.length}`;
}

async function send(wallet, functionName, args) {
  const hash = await wallet.writeContract({ address: config.ESCROW_CONTRACT_ADDRESS, abi: ESCROW_ABI, functionName, args });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

/** The party has to act from their own wallet first; the server cannot do it for them. */
const walletActionRequired = (fn, id, message) => new HttpError(409, 'wallet_action_required', message, { function: fn, escrowId: id });

/**
 * Bring the escrow to its end state, or confirm it is already there.
 *
 * kind 'release': the fulfiller is paid.  kind 'refund': the depositor gets everything back.
 * Returns a transaction hash, or 'settled-on-chain' when a party (or anyone) already did it.
 * Throws 409 wallet_action_required when only the depositor can make the next move, and 409 chain_mismatch when the
 * chain already ended the other way.
 */
export async function settleOnChain({ requestId, depositor, kind, to }) {
  const ref = escrowRefFor(requestId);
  if (isMock) return mockSend(kind, kind === 'release' ? [ref, getAddress(to)] : [ref]);

  const id = escrowIdOf(depositor, ref);
  const [e, now] = await Promise.all([readEscrow(id), chainNow()]);
  const done = kind === 'release' ? 'released' : 'refunded';
  const opposite = kind === 'release' ? 'refunded' : 'released';

  if (e.status === done || e.status === 'resolved') return 'settled-on-chain';
  if (e.status === opposite) throw new HttpError(409, 'chain_mismatch', `The escrow was already ${opposite} on-chain`);
  if (e.status === 'none') throw new HttpError(409, 'chain_mismatch', 'There is no deposit on-chain for this order');

  if (e.status === 'disputed') {
    if (!arbiter) throw new HttpError(503, 'arbiter_not_configured', 'This server has no arbiter key; the arbiter must send resolve() to the escrow');
    return send(arbiter, 'resolve', [id, kind === 'release' ? e.amount : 0n]);
  }

  if (kind === 'release') {
    if (e.status === 'delivered' && now >= e.deadline) return send(keeper, 'claim', [id]);
    throw walletActionRequired('release', id, 'Send release() from the spender wallet to pay the buyer, then confirm again');
  }

  // refund
  if (e.status === 'funded' && now >= e.deadline) return send(keeper, 'refundExpired', [id]);
  if (e.status === 'funded' && !e.fulfiller) {
    throw walletActionRequired('cancel', id, 'Send cancel() from the spender wallet to take the deposit back, then cancel again');
  }
  throw new HttpError(409, 'refund_not_possible', 'A buyer is bound to this escrow on-chain; it can only be refunded after their deadline, by the buyer, or through a dispute');
}

// ---------- Dispute stake: mock mode only ----------
// On-chain the stake is part of VoucherEscrowV2 itself: dispute() locks the token's disputeBond from the spender and
// the contract returns or forfeits it when the dispute ends. This server never touches it. The functions below only
// simulate that for the local mock; config refuses DISPUTE_BOND_USDC when ESCROW_MODE=chain (the contract sets it).

const mockOnly = () => {
  if (!isMock) throw new HttpError(501, 'bond_unavailable', 'On-chain, the dispute stake is handled by the escrow contract itself');
};

/**
 * The bond id contains a secret nonce the server gives only to the person who will stake, so nobody can
 * front-run (deposit into) another person's bond id and block their dispute.
 */
export const bondIdFor = (requestId, actor, nonce) => keccak256(stringToHex(`dispute-bond:${requestId}:${actor}:${nonce}`));
export async function verifyBondDeposit() {
  mockOnly();
  if (mockFaults.has('verifyDeposit')) throw new HttpError(400, 'escrow_not_funded', 'Escrow is not in Funded state');
  return { ok: true };
}
export async function readBondStatus() {
  mockOnly();
  return 'unknown';
}
export async function releaseBond(id, to) {
  mockOnly();
  return mockSend('release', [id, getAddress(to)]);
}
export async function refundBond(id) {
  mockOnly();
  return mockSend('refund', [id]);
}
