/** Types for the browser. The implementation is vault-sdk/index.js. */
export const VERSION: number;
export const KEY_MESSAGE: string;

export type VaultKeys = {
  privateKey: Uint8Array;
  publicKey: Uint8Array;
  publicKeyHex: string;
  stateKey: Uint8Array;
};

export type SealedRecipient = { kid: string; epk: string; iv: string; wrapped: string };

export type SealedEnvelope = {
  v: number;
  alg: string;
  iv: string;
  ct: string;
  recipients: SealedRecipient[];
};

export function keyBindingMessage(address: string, publicKeyHex: string): string;
export function voucherAad(requestId: string, requester: string, fulfiller: string): string;
export function assertDeterministicSignature(sigA: string, sigB: string): void;
export function deriveVaultKeys(signatureHex: string): VaultKeys;
export function seal(payload: unknown, recipientPublicKeys: string[], aad: string): SealedEnvelope;
export function open(envelope: unknown, privateKey: Uint8Array, aad: string): { code?: string; pin?: string | null };
