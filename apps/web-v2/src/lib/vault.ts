/**
 * Wallet session for the voucher vault.
 * The private key lives in memory for this tab only. It is rebuilt by signing the same message again.
 */
import { ApiError, api, type VaultConfig, type VaultKeyRecord } from "./api";
import {
  assertDeterministicSignature,
  deriveVaultKeys,
  keyBindingMessage,
  openSealed,
  recoverSigner,
  sealTo,
  voucherAad,
  type SealedEnvelope,
  type VaultKeys,
} from "./vaultCrypto";

const session = new Map<string, VaultKeys>();

export function clearVaultSession() {
  session.clear();
}

export type SealResult = { legacy: true } | { legacy: false; sealed: SealedEnvelope };

const SPENDER_VAULT_MISSING = "The spender hasn't set up their vault yet. Ask them to open this order and unlock it. The code stays on this page until then.";

function same(a: string, b: string) {
  return a.toLowerCase() === b.toLowerCase();
}

/** One signature rebuilds the key. It must match the public key already published for this wallet. */
export async function unlockVault(address: string, token: string, signMessage: (message: string) => Promise<string>): Promise<VaultKeys> {
  const id = address.toLowerCase();
  const cached = session.get(id);
  if (cached) return cached;

  const { key } = await api.getVaultKey(address, token);
  const cfg = await api.vaultConfig();
  const signature = await signMessage(cfg.keyMessage);
  const keys = deriveVaultKeys(signature);
  if (keys.publicKeyHex.toLowerCase() !== key.publicKey.toLowerCase()) {
    throw new Error("This signature doesn't rebuild your registered vault key. Sign the vault message on this site with the same wallet.");
  }
  session.set(id, keys);
  return keys;
}

/**
 * Publish this wallet's vault public key, once. The wallet signs the key message twice (they must match)
 * and then signs a binding that proves the key belongs to this address.
 */
export async function registerVault(
  address: string,
  token: string,
  signMessage: (message: string) => Promise<string>,
  onPhase?: (text: string) => void,
): Promise<VaultKeyRecord> {
  try {
    const existing = await api.getVaultKey(address, token);
    return existing.key;
  } catch (e) {
    if (!(e instanceof ApiError) || e.status !== 404) throw e;
  }

  const cfg = await api.vaultConfig();
  onPhase?.("Sign the vault key in your wallet. This costs no gas and moves no funds.");
  const first = await signMessage(cfg.keyMessage);
  onPhase?.("Sign the same message again. The two signatures must match, so the key can be rebuilt later.");
  const second = await signMessage(cfg.keyMessage);
  assertDeterministicSignature(first, second);
  const keys = deriveVaultKeys(first);
  onPhase?.("Sign once more to publish the public key. The private key stays in this browser.");
  const signature = await signMessage(keyBindingMessage(address, keys.publicKeyHex));
  const { key } = await api.putVaultKey({ publicKey: keys.publicKeyHex, signature }, token);
  session.set(address.toLowerCase(), keys);
  return key;
}

/** Lock a code to the spender's published key (and the dispute key, when the server has one). */
export async function sealVoucher(opts: {
  requestId: string;
  spender: string;
  buyer: string;
  code: string;
  pin: string | null;
  token: string;
}): Promise<SealResult> {
  const code = opts.code.trim();
  const pin = opts.pin?.trim() ? opts.pin.trim() : null;
  if (code.length < 4) throw new Error("Enter the voucher code.");
  if (pin && pin.length > 32) throw new Error("The PIN is too long.");

  const cfg: VaultConfig = await api.vaultConfig();
  if (cfg.mode === "legacy") {
    if (code.length > 128) throw new Error("This server accepts a code up to 128 characters.");
    return { legacy: true };
  }
  if (code.length > 400) throw new Error("That code is too long to seal.");

  let key: VaultKeyRecord;
  try {
    key = (await api.getVaultKey(opts.spender, opts.token)).key;
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new Error(SPENDER_VAULT_MISSING);
    throw e;
  }
  if (!same(key.address, opts.spender)) {
    throw new Error("The vault key on file is for a different wallet. The code was not sent.");
  }
  let who: string;
  try {
    who = recoverSigner(keyBindingMessage(key.address, key.publicKey), key.signature);
  } catch {
    throw new Error("The spender's vault key failed its signature check. The code was not sent.");
  }
  if (!same(who, opts.spender)) {
    throw new Error("The spender's vault key isn't signed by their wallet. The code was not sent.");
  }

  const recipients = [key.publicKey, ...(cfg.adminPublicKey ? [cfg.adminPublicKey] : [])];
  const sealed = sealTo({ code, pin }, recipients, voucherAad(opts.requestId, opts.spender, opts.buyer));
  return { legacy: false, sealed };
}

export async function readSealedVoucher(
  voucher: { requestId: string; requester: string; fulfiller: string; sealed: unknown },
  keys: VaultKeys,
) {
  return openSealed(voucher.sealed, keys.privateKey, voucherAad(voucher.requestId, voucher.requester, voucher.fulfiller));
}
