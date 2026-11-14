import { config } from '../config.js';

/**
 * The spender's "Ready" permit. It is the escrow's own Assign message (contracts/src/VoucherEscrowV2.sol):
 *   Assign(bytes32 id, address fulfiller, uint32 epoch, uint64 validUntil), EIP-712, domain "NetPositiveEscrow" v2.
 * It says: "THIS buyer may take my order until validUntil." Gasless for the spender: it is only a signature. The buyer
 * sends it to escrow.accept(id, validUntil, signature), which binds them on-chain as the only address that can be paid.
 * `epoch` is read from the escrow; it changes when a buyer steps away, so an old permit cannot be reused.
 */
export const READY_TYPES = {
  Assign: [
    { name: 'id', type: 'bytes32' },
    { name: 'fulfiller', type: 'address' },
    { name: 'epoch', type: 'uint32' },
    { name: 'validUntil', type: 'uint64' },
  ],
};

const DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

/** Stands in for the contract address in mock mode, so wallets still get well-formed typed data. */
const MOCK_VERIFYING_CONTRACT = '0x0000000000000000000000000000000000000001';

export const READY_DEFAULT_SECONDS = 10 * 60; // what we ask the wallet to sign by default
export const READY_MAX_SECONDS = 60 * 60; // longest permit we accept

export const readyDomain = () => ({
  name: 'NetPositiveEscrow',
  version: '2',
  chainId: config.ARC_CHAIN_ID,
  verifyingContract: config.ESCROW_CONTRACT_ADDRESS || MOCK_VERIFYING_CONTRACT,
});

/** The JSON a wallet signs with eth_signTypedData_v4. */
export function readyTypedData({ escrowId, fulfiller, epoch, validUntil }) {
  return {
    domain: readyDomain(),
    types: { EIP712Domain: DOMAIN_TYPE, ...READY_TYPES },
    primaryType: 'Assign',
    message: { id: escrowId, fulfiller, epoch, validUntil: String(validUntil) },
  };
}
