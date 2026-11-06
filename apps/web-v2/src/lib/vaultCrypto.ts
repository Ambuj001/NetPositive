/**
 * Browser half of the voucher vault (backend/vault-sdk).
 * A code is sealed here to the spender's X25519 key. The server stores the envelope and cannot read it.
 */
import { secp256k1 } from "@noble/curves/secp256k1.js";
import { keccak_256 } from "@noble/hashes/sha3.js";
import {
  assertDeterministicSignature,
  deriveVaultKeys,
  keyBindingMessage,
  open,
  seal,
  voucherAad,
  type SealedEnvelope,
  type VaultKeys,
} from "../../../../backend/vault-sdk/index.js";

export { assertDeterministicSignature, deriveVaultKeys, keyBindingMessage, voucherAad, type SealedEnvelope, type VaultKeys };

const enc = new TextEncoder();

function concat(a: Uint8Array, b: Uint8Array) {
  const out = new Uint8Array(a.length + b.length);
  out.set(a, 0);
  out.set(b, a.length);
  return out;
}

function signatureBytes(signatureHex: string) {
  const h = signatureHex.replace(/^0x/, "");
  if (!/^[0-9a-fA-F]{130}$/.test(h)) throw new Error("The vault-key signature is not a 65-byte signature.");
  return Uint8Array.from(h.match(/../g) ?? [], (x) => parseInt(x, 16));
}

/** Address that produced a personal_sign signature. Same check the server runs before it trusts a vault key. */
export function recoverSigner(message: string, signatureHex: string): string {
  const sig = signatureBytes(signatureHex);
  const msg = enc.encode(message);
  const prefix = enc.encode(`\u0019Ethereum Signed Message:\n${msg.length}`);
  const hash = keccak_256(concat(prefix, msg));
  let v = sig[64] ?? 0;
  if (v >= 27) v -= 27;
  if (v !== 0 && v !== 1) throw new Error("The vault-key signature has a bad recovery id.");
  const pub = secp256k1.Signature.fromCompact(sig.slice(0, 64)).addRecoveryBit(v).recoverPublicKey(hash);
  const raw = pub.toRawBytes(false).slice(1);
  const addr = keccak_256(raw).slice(-20);
  return `0x${[...addr].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

export function sealTo(payload: { code: string; pin: string | null }, recipientPublicKeys: string[], aad: string): SealedEnvelope {
  return seal(payload, recipientPublicKeys, aad);
}

export function openSealed(envelope: unknown, privateKey: Uint8Array, aad: string): { code: string; pin: string | null } {
  const payload = open(envelope, privateKey, aad);
  if (!payload || typeof payload.code !== "string" || payload.code.length < 1) {
    throw new Error("The sealed voucher didn't contain a code.");
  }
  const pin = typeof payload.pin === "string" && payload.pin.length > 0 ? payload.pin : null;
  return { code: payload.code, pin };
}
