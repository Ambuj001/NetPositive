import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

const ACCEPTED_CREDENTIALS = new Set(['proof_of_human', 'orb']);

export function worldIdReady() {
  return Boolean(config.WORLD_ID_RP_ID && config.WORLD_ID_SIGNING_KEY);
}

function requireWorldIdConfig() {
  if (worldIdReady()) return;
  throw new HttpError(
    503,
    'not_configured',
    'Set WORLD_ID_RP_ID and WORLD_ID_SIGNING_KEY from the Developer Portal. Enable World ID 4.0 there first.',
  );
}

/**
 * Sign the Proof of Human request. The signing key never leaves the server.
 * Returns the rp_context fields IDKit expects, plus the public rp_id.
 */
export function signWorldIdRequest() {
  requireWorldIdConfig();
  const signed = signRequest({
    signingKeyHex: config.WORLD_ID_SIGNING_KEY,
    action: config.WORLD_ID_ACTION,
  });
  return {
    sig: signed.sig,
    nonce: signed.nonce,
    created_at: signed.createdAt,
    expires_at: signed.expiresAt,
    rp_id: config.WORLD_ID_RP_ID,
    app_id: config.WORLD_ID_APP_ID,
    action: config.WORLD_ID_ACTION,
  };
}

/** Store hex nullifiers lowercase and decimal nullifiers without leading zeros. */
export function canonicalNullifier(value) {
  const raw = String(value ?? '').trim();
  if (/^0x[0-9a-fA-F]{64}$/.test(raw)) return raw.toLowerCase();
  if (/^[0-9]+$/.test(raw)) return BigInt(raw).toString(10);
  throw new HttpError(400, 'world_id_invalid', 'World ID proof is missing a nullifier');
}

function verifyBase(rpId) {
  let base = config.WORLD_ID_VERIFY_URL.replace(/\/$/, '');
  if (base.includes('/api/v2/')) base = 'https://developer.world.org/api/v4/verify';
  return base.endsWith(`/${rpId}`) ? base : `${base}/${rpId}`;
}

/**
 * Check an IDKit result, then ask World's v4 verifier to confirm it.
 * The signal must be the signed-in wallet. Only Proof of Human (or a legacy Orb proof) is accepted.
 * Returns { nullifierHash, verificationLevel }.
 */
export async function verifyWorldIdProof(payload, wallet) {
  requireWorldIdConfig();
  const proof = payload.idkitResponse;

  if (payload.rp_id !== config.WORLD_ID_RP_ID) {
    throw new HttpError(400, 'world_id_rp', 'This proof is for a different World ID app');
  }
  if (proof.environment !== config.WORLD_ID_ENV) {
    throw new HttpError(400, 'world_id_environment', `World ID environment "${proof.environment}" is not accepted`);
  }
  if (proof.action !== config.WORLD_ID_ACTION) {
    throw new HttpError(400, 'world_id_action', 'This proof is for a different action');
  }

  const item = proof.responses.find((response) => ACCEPTED_CREDENTIALS.has(response.identifier));
  if (!item) {
    throw new HttpError(400, 'world_id_credential', 'Proof of Human is required');
  }
  if (item.identifier === 'proof_of_human' && item.issuer_schema_id != null && item.issuer_schema_id !== 1) {
    throw new HttpError(400, 'world_id_credential', 'Proof of Human is required');
  }

  const expectedSignal = hashSignal(wallet).toLowerCase();
  if ((item.signal_hash ?? '').toLowerCase() !== expectedSignal) {
    throw new HttpError(400, 'world_id_signal', 'This proof is not bound to the signed-in wallet');
  }

  const nullifierHash = canonicalNullifier(item.nullifier);

  if (config.WORLD_ID_MOCK) {
    return { nullifierHash, verificationLevel: item.identifier };
  }

  let res;
  try {
    res = await fetch(verifyBase(config.WORLD_ID_RP_ID), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ...proof, environment: config.WORLD_ID_ENV }),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (err) {
    throw new HttpError(502, 'world_id_unreachable', `World ID verifier unreachable: ${err.message}`);
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok || body.success !== true || body.environment !== config.WORLD_ID_ENV) {
    throw new HttpError(400, body.code ?? 'world_id_invalid', body.detail ?? body.message ?? 'World ID proof rejected', { status: res.status });
  }

  return { nullifierHash, verificationLevel: item.identifier };
}
