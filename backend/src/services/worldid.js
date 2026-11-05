import { keccak256, toBytes } from 'viem';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

/**
 * Same as IDKit's hashToField: keccak256(bytes) >> 8, as a 32-byte hex string.
 * The frontend must pass the wallet address as the IDKit `signal`; hex strings are
 * hashed as raw bytes, so checksum vs. lowercase doesn't matter.
 */
export function hashToField(signal) {
  // viem's toBytes decodes hex strings as bytes and other strings as UTF-8, matching IDKit.
  const shifted = BigInt(keccak256(toBytes(signal))) >> 8n;
  return `0x${shifted.toString(16).padStart(64, '0')}`;
}

const LEVEL_RANK = { device: 1, orb: 2 };

/**
 * Verify an IDKit proof against World's cloud verifier.
 * `proof` is the object IDKit's onSuccess hands the frontend:
 *   { proof, merkle_root, nullifier_hash, verification_level }
 * Returns { nullifierHash, verificationLevel } on success.
 */
export async function verifyWorldIdProof(proof, signal) {
  const level = proof.verification_level;
  if ((LEVEL_RANK[level] ?? 0) < LEVEL_RANK[config.WORLD_ID_MIN_LEVEL]) {
    throw new HttpError(403, 'world_id_level_too_low', `Verification level "${level}" is below required "${config.WORLD_ID_MIN_LEVEL}"`);
  }

  if (config.WORLD_ID_MOCK) {
    // Local testing only (config.js refuses this in production).
    return { nullifierHash: proof.nullifier_hash.toLowerCase(), verificationLevel: level };
  }

  const url = `${config.WORLD_ID_VERIFY_URL.replace(/\/$/, '')}/${config.WORLD_ID_APP_ID}`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        nullifier_hash: proof.nullifier_hash,
        merkle_root: proof.merkle_root,
        proof: proof.proof,
        verification_level: level,
        action: config.WORLD_ID_ACTION,
        signal_hash: hashToField(signal),
      }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new HttpError(502, 'world_id_unreachable', `World ID verifier unreachable: ${err.message}`);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success === false) {
    // e.g. invalid_proof, invalid_merkle_root, max_verifications_reached
    throw new HttpError(400, body.code ?? 'world_id_invalid', body.detail ?? 'World ID proof rejected', { status: res.status });
  }

  return { nullifierHash: proof.nullifier_hash.toLowerCase(), verificationLevel: level };
}
