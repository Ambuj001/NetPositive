import { config } from '../config.js';

/**
 * The spender's "Ready" permit for the CodeMailbox (contracts/private-transfer/src/CodeMailbox.sol):
 *   Ready(bytes32 escrowId, address fulfiller, uint64 validUntil), EIP-712, domain "NetPositiveCodeMailbox" v1.
 * It says: "I am ready, and THIS buyer may deliver the voucher code until validUntil." Gasless: it is only a signature.
 */
export const READY_TYPES = {
  Ready: [
    { name: 'escrowId', type: 'bytes32' },
    { name: 'fulfiller', type: 'address' },
    { name: 'validUntil', type: 'uint64' },
  ],
};

const DOMAIN_TYPE = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
  { name: 'verifyingContract', type: 'address' },
];

export const READY_DEFAULT_SECONDS = 10 * 60; // what we ask the wallet to sign by default
export const READY_MAX_SECONDS = 60 * 60; // longest permit we accept

export const readyDomain = () => ({
  name: 'NetPositiveCodeMailbox',
  version: '1',
  chainId: config.ARC_CHAIN_ID,
  verifyingContract: config.CODE_MAILBOX_ADDRESS,
});

/** The JSON a wallet signs with eth_signTypedData_v4. */
export function readyTypedData({ escrowId, fulfiller, validUntil }) {
  return {
    domain: readyDomain(),
    types: { EIP712Domain: DOMAIN_TYPE, ...READY_TYPES },
    primaryType: 'Ready',
    message: { escrowId, fulfiller, validUntil: String(validUntil) },
  };
}
