import type { Address, Hex } from 'viem'

export const ATTESTATION_DOMAIN_NAME = 'NetPositive'
export const ATTESTATION_DOMAIN_VERSION = '1'

export const attestationTypes = {
  DeliveryAttestation: [
    { name: 'tradeId', type: 'bytes32' },
    { name: 'deliveryDigest', type: 'bytes32' },
    { name: 'buyerRecipient', type: 'bytes32' },
    { name: 'expiry', type: 'uint64' },
  ],
} as const

export interface DeliveryAttestationMessage {
  tradeId: Hex
  deliveryDigest: Hex
  buyerRecipient: Hex
  expiry: bigint
}

/** EIP-712 domain: binds the signature to this chain and this contract instance. */
export const attestationDomain = (chainId: number, verifyingContract: Address) =>
  ({
    name: ATTESTATION_DOMAIN_NAME,
    version: ATTESTATION_DOMAIN_VERSION,
    chainId,
    verifyingContract,
  }) as const

export const attestationTypedData = (
  chainId: number,
  verifyingContract: Address,
  message: DeliveryAttestationMessage,
) =>
  ({
    domain: attestationDomain(chainId, verifyingContract),
    types: attestationTypes,
    primaryType: 'DeliveryAttestation',
    message,
  }) as const
