import { keccak256, toBytes } from 'viem';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { config } from '../config.js';
import { HttpError } from '../lib/errors.js';

const ACCEPTED_CREDENTIALS = new Set(['proof_of_human', 'orb']);

export function worldIdReady() {
  return Boolean(config.WORLD_ID_RP_ID && config.WORLD_ID_SIGNING_KEY) && !worldIdProblem();
}

let problemCache;
/**
 * A plain-language reason World ID can't work with the current settings, or null. Checked once: it signs a throwaway
 * request, so a signing key that is the right length but not a usable secp256k1 key is caught at startup instead of
 * as a 500 in front of a user.
 */
export function worldIdProblem() {
  if (problemCache !== undefined) return problemCache;
  problemCache = null;
  if (!config.WORLD_ID_RP_ID || !config.WORLD_ID_SIGNING_KEY) return problemCache;
  if (!/^rp_[0-9a-zA-Z]+$/.test(config.WORLD_ID_RP_ID)) {
    problemCache = 'WORLD_ID_RP_ID should look like rp_… (copy it from the World Developer Portal, World ID 4.0 section). It is not the app id.';
    return problemCache;
  }
  if (!/^app_/.test(config.WORLD_ID_APP_ID)) {
    problemCache = 'WORLD_ID_APP_ID should start with app_.';
    return problemCache;
  }
  try {
    signRequest({ signingKeyHex: signingKey(), action: config.WORLD_ID_ACTION });
  } catch (err) {
    problemCache = `WORLD_ID_SIGNING_KEY is not a usable signing key (${err.message}). Create a new one in the World Developer Portal and paste it exactly.`;
  }
  return problemCache;
}

/** idkit accepts lowercase hex with or without 0x; normalise so "0X…" or upper-case keys also work. */
const signingKey = () => `0x${config.WORLD_ID_SIGNING_KEY.trim().replace(/^0x/i, '').toLowerCase()}`;

function requireWorldIdConfig() {
  if (worldIdReady()) return;
  const problem = worldIdProblem();
  if (problem) throw new HttpError(503, 'not_configured', problem);
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
  let signed;
  try {
    signed = signRequest({ signingKeyHex: signingKey(), action: config.WORLD_ID_ACTION });
  } catch (err) {
    throw new HttpError(503, 'not_configured', `The server could not sign the World ID request (${err.message}). Check WORLD_ID_SIGNING_KEY.`);
  }
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

/**
 * DEV BYPASS ONLY. A stable fake "person" for a wallet, so each test wallet registers as its own human and the
 * one-wallet-per-human rule still holds. It is a hash of the wallet, never a real World ID.
 */
export const devBypassNullifier = (wallet) => keccak256(toBytes(`netpositive-dev-bypass:${String(wallet).toLowerCase()}`));

/**
 * One spelling per nullifier, so the same human can never register twice under two spellings.
 * Hex (World ID 3 proofs) is stored as 0x + 64 lowercase digits, whatever padding or case it arrived in.
 * Decimal (World ID 4 proofs) is stored without leading zeros.
 */
export function canonicalNullifier(value) {
  const raw = String(value ?? '').trim();
  if (/^0x[0-9a-fA-F]{1,64}$/i.test(raw)) return `0x${raw.slice(2).toLowerCase().padStart(64, '0')}`;
  if (/^[0-9]{1,78}$/.test(raw)) return BigInt(raw).toString(10);
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
function sameNumber(a, b) {
  try {
    return BigInt(String(a ?? '').trim()) === BigInt(String(b).trim());
  } catch {
    return false;
  }
}

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

  // Compare as numbers: wallets and World App versions differ in padding, case and hex vs decimal.
  if (!sameNumber(item.signal_hash, hashSignal(wallet))) {
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
  // World's documented contract is `success: true`. `environment` is compared only when World includes it.
  const wrongEnv = typeof body.environment === 'string' && body.environment !== config.WORLD_ID_ENV;
  if (!res.ok || body.success !== true || wrongEnv) {
    if (res.status >= 500) throw new HttpError(502, 'world_id_unreachable', `World's verifier is having trouble (HTTP ${res.status}). Try again in a minute.`);
    const reason = [body.detail, body.message, body.code].find((v) => typeof v === 'string' && v) ?? 'World did not accept this proof';
    throw new HttpError(400, 'world_id_rejected', wrongEnv ? `This proof was made for "${body.environment}", but the server expects "${config.WORLD_ID_ENV}".` : `World ID: ${reason}`, {
      status: res.status,
      code: typeof body.code === 'string' ? body.code : null,
      attribute: typeof body.attribute === 'string' ? body.attribute : null,
    });
  }

  return { nullifierHash, verificationLevel: item.identifier };
}
