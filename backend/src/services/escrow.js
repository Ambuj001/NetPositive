import { createPublicClient, createWalletClient, defineChain, http, keccak256, stringToHex, getAddress } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

/**
 * Expected escrow contract interface (write this in Arc Studio / Foundry):
 *
 *   enum Status { None, Funded, Released, Refunded }
 *   function deposit(bytes32 id, uint256 amount) external;            // requester, after USDC approve
 *   function release(bytes32 id, address to) external onlyOperator;   // pay fulfiller
 *   function refund(bytes32 id) external onlyOperator;                // back to depositor
 *   function escrows(bytes32 id) external view
 *       returns (address depositor, uint256 amount, uint8 status);
 *
 * Recommended extra (for CROPS / no-admin-freeze): a permissionless
 * claimAfterTimeout() so funds can't be stuck if this backend disappears.
 */
export const ESCROW_ABI = [
  {
    type: 'function', name: 'escrows', stateMutability: 'view',
    inputs: [{ name: 'id', type: 'bytes32' }],
    outputs: [
      { name: 'depositor', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'status', type: 'uint8' },
    ],
  },
  {
    type: 'function', name: 'release', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }, { name: 'to', type: 'address' }], outputs: [],
  },
  {
    type: 'function', name: 'refund', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }], outputs: [],
  },
  {
    type: 'function', name: 'deposit', stateMutability: 'nonpayable',
    inputs: [{ name: 'id', type: 'bytes32' }, { name: 'amount', type: 'uint256' }], outputs: [],
  },
];

const STATUS = { None: 0, Funded: 1, Released: 2, Refunded: 3 };

export const arc = defineChain({
  id: config.ARC_CHAIN_ID,
  name: 'Arc',
  nativeCurrency: { name: 'USDC', symbol: 'USDC', decimals: 18 }, // Arc gas token; ERC-20 USDC interface uses 6
  rpcUrls: { default: { http: [config.ARC_RPC_URL] } },
});

export const publicClient = createPublicClient({ chain: arc, transport: http(config.ARC_RPC_URL) });

const operator = config.ESCROW_OPERATOR_PRIVATE_KEY
  ? privateKeyToAccount(config.ESCROW_OPERATOR_PRIVATE_KEY)
  : null;
const walletClient = operator
  ? createWalletClient({ account: operator, chain: arc, transport: http(config.ARC_RPC_URL) })
  : null;

const isMock = config.ESCROW_MODE === 'mock';
if (isMock) console.warn('[escrow] ESCROW_MODE=mock: on-chain checks and payouts are SIMULATED.');

/** Deterministic on-chain id for a Firestore request id. The frontend must use the same. */
export const escrowIdFor = (requestId) => keccak256(stringToHex(requestId));

/**
 * Confirm the requester actually locked the expected USDC for this request.
 * We check contract state (not just the tx receipt) so a spoofed or unrelated tx can't pass.
 */
export async function verifyDeposit({ requestId, depositor, amountBaseUnits, txHash }) {
  if (isMock) return { ok: true };

  const receipt = await publicClient.getTransactionReceipt({ hash: txHash }).catch(() => null);
  if (!receipt || receipt.status !== 'success') {
    throw new HttpError(400, 'tx_not_confirmed', 'Escrow transaction not found or failed');
  }
  if (getAddress(receipt.to ?? '0x0000000000000000000000000000000000000000') !== getAddress(config.ESCROW_CONTRACT_ADDRESS)) {
    throw new HttpError(400, 'tx_wrong_contract', 'Transaction was not sent to the escrow contract');
  }

  const [onchainDepositor, amount, status] = await publicClient.readContract({
    address: config.ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'escrows',
    args: [escrowIdFor(requestId)],
  });

  if (status !== STATUS.Funded) throw new HttpError(400, 'escrow_not_funded', 'Escrow is not in Funded state');
  if (getAddress(onchainDepositor) !== getAddress(depositor)) {
    throw new HttpError(400, 'escrow_wrong_depositor', 'Escrow depositor does not match requester');
  }
  if (amount < BigInt(amountBaseUnits)) {
    throw new HttpError(400, 'escrow_underfunded', `Escrow holds ${amount}, expected ${amountBaseUnits}`);
  }
  return { ok: true };
}

/** On-chain status for reconciliation: 'none' | 'funded' | 'released' | 'refunded' | 'unknown' (mock). */
export async function readEscrowStatus(requestId) {
  if (isMock) return 'unknown';
  const [, , status] = await publicClient.readContract({
    address: config.ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName: 'escrows',
    args: [escrowIdFor(requestId)],
  });
  return ['none', 'funded', 'released', 'refunded'][status] ?? 'unknown';
}

async function send(functionName, args) {
  if (isMock) return `0xmock${Date.now().toString(16)}`;
  const hash = await walletClient.writeContract({
    address: config.ESCROW_CONTRACT_ADDRESS,
    abi: ESCROW_ABI,
    functionName,
    args,
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash, timeout: 60_000 });
  if (receipt.status !== 'success') throw new Error(`${functionName} reverted (${hash})`);
  return hash;
}

export const releaseEscrow = (requestId, to) => send('release', [escrowIdFor(requestId), getAddress(to)]);
export const refundEscrow = (requestId) => send('refund', [escrowIdFor(requestId)]);
