import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { signRequest } from '@worldcoin/idkit-core/signing';
import { hashSignal } from '@worldcoin/idkit-core/hashing';
import { config } from '../config.js';
import { col, db, Timestamp } from './firestore.js';
import { HttpError, forbidden } from '../lib/errors.js';

/**
 * World ID v4 (IDKit 4.x), Proof of Human only.
 *
 * Flow:  POST /world-id/request  → server signs an RP request bound to this wallet (nonce stored)
 *        IDKit widget runs in the browser, the user proves they are a unique human
 *        POST /world-id/verify   → we check the nonce + signal, forward the proof to World, and only
 *                                  accept it when World answers success:true for OUR app/action/environment.
 *
 * Why Proof of Human and nothing weaker: the product event is "one real person gets one account that can be
 * banned for good" (fraud ban) and "the same person can take over their escrow from a new wallet" (recovery).
 * Both need uniqueness. A device-level or liveness-only credential cannot give a stable per-human nullifier.
 */

const REQUEST_TTL_SECONDS = 300;
// IDKit's types say proof elements and the nullifier are DECIMAL strings; older docs show 0x-hex. Accept both.
const numeric = z.string().regex(/^(0x[0-9a-fA-F]{1,64}|\d{1,78})$/);

// Loose on purpose: World may add fields. We validate what we rely on and forward the ORIGINAL payload to World.
const proofSchema = z.looseObject({
  protocol_version: z.literal('4.0'),
  nonce: z.string().min(1).max(100),
  action: z.string(),
  environment: z.string(),
  responses: z
    .array(
      z.looseObject({
        identifier: z.literal('proof_of_human'),
        signal_hash: numeric,
        proof: z.array(numeric).length(5),
        nullifier: numeric,
        issuer_schema_id: z.literal(1),
        expires_at_min: z.number().int().nonnegative(), // the minimum credential expiry the request asked for, NOT a deadline
      }),
    )
    .length(1),
});

/** Tests replace this to simulate World's verifier without network access. */
export const upstream = { fetch: (...args) => globalThis.fetch(...args) };

const isMock = () => config.WORLD_ID_MOCK;

function assertConfigured() {
  if (isMock()) return;
  if (!config.WORLD_RP_ID || !config.WORLD_RP_SIGNING_KEY) {
    throw new HttpError(503, 'world_id_not_configured', 'World ID is not configured (WORLD_RP_ID / WORLD_RP_SIGNING_KEY)');
  }
}

/** Step 1: signed request for the IDKit widget. The signal is the wallet, so the proof cannot be reused elsewhere. */
export async function createRequest(address) {
  assertConfigured();
  let nonce, createdAt, expiresAt, sig;
  if (isMock()) {
    nonce = `0x${randomBytes(32).toString('hex')}`;
    createdAt = Math.floor(Date.now() / 1000);
    expiresAt = createdAt + REQUEST_TTL_SECONDS;
    sig = '0xmock';
  } else {
    ({ sig, nonce, createdAt, expiresAt } = signRequest({
      signingKeyHex: config.WORLD_RP_SIGNING_KEY,
      action: config.WORLD_ID_ACTION,
      ttl: REQUEST_TTL_SECONDS,
    }));
  }
  await col.worldRequests.doc(address).set({ nonce, expiresAt: Timestamp.fromMillis(expiresAt * 1000) });
  return {
    app_id: config.WORLD_ID_APP_ID,
    action: config.WORLD_ID_ACTION,
    environment: config.WORLD_ENVIRONMENT,
    signal: address,
    rp_context: { rp_id: config.WORLD_RP_ID, nonce, created_at: createdAt, expires_at: expiresAt, signature: sig },
  };
}

/** Use the pending request exactly once (replay protection). Burned even if verification later fails. */
async function consumeRequest(address, nonce) {
  const ref = col.worldRequests.doc(address);
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) throw forbidden('world_request_missing', 'Start the World ID check again');
    tx.delete(ref);
    const d = snap.data();
    if (d.nonce !== nonce) throw forbidden('world_request_mismatch', 'Start the World ID check again');
    if (d.expiresAt.toMillis() <= Date.now()) throw forbidden('world_request_expired', 'World ID request expired; start again');
  });
}

/**
 * Step 2: verify the IDKit result for this wallet.
 * Returns { nullifier, level }. `nullifier` is the canonical decimal string so two hex
 * spellings of the same number can never be treated as two humans.
 */
export async function verifyProof(address, body) {
  assertConfigured();
  const parsed = proofSchema.safeParse(body);
  if (!parsed.success) {
    // Paths and messages only: never echo proof values back.
    const issues = parsed.error.issues.map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`);
    throw new HttpError(400, 'world_id_bad_proof', 'Malformed World ID result', issues);
  }
  const raw = parsed.data;
  const proof = raw.responses[0];

  if (raw.action !== config.WORLD_ID_ACTION || raw.environment !== config.WORLD_ENVIRONMENT) {
    throw forbidden('world_id_wrong_context', 'Proof was made for a different action or environment');
  }
  await consumeRequest(address, raw.nonce);
  if (BigInt(proof.signal_hash) !== BigInt(hashSignal(address))) {
    throw forbidden('world_id_wrong_wallet', 'Proof was made for a different wallet');
  }
  // Freshness comes from the single-use request nonce above (5 min). `expires_at_min` is the minimum credential
  // expiry the request asked for, not a deadline for the proof, and World's verifier checks it. Do not compare it to now.

  if (!isMock()) {
    // Forward the complete payload exactly as received. Fixed endpoint; no redirects.
    let verification;
    try {
      const res = await upstream.fetch(`https://developer.world.org/api/v4/verify/${encodeURIComponent(config.WORLD_RP_ID)}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body), // the ORIGINAL payload, unchanged
        signal: AbortSignal.timeout(10_000),
        redirect: 'error',
      });
      const json = await res.json().catch(() => ({}));
      if (res.status >= 400 && res.status < 500) {
        // World refused this proof: pass its reason along (an error code, never proof values).
        throw new HttpError(403, 'world_id_rejected', json.detail ?? json.message ?? 'World ID proof refused', {
          status: res.status,
          code: json.code ?? json.error ?? null,
          detail: json.detail ?? json.message ?? null,
        });
      }
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      verification = json;
    } catch (err) {
      if (err instanceof HttpError) throw err;
      throw new HttpError(502, 'world_id_unreachable', `World ID verification unavailable or refused (${err.message})`);
    }
    // Explicit success is required. `environment` is only compared when World includes it.
    if (verification.success !== true || (verification.environment && verification.environment !== config.WORLD_ENVIRONMENT)) {
      throw new HttpError(403, 'world_id_rejected', 'World ID proof refused', { status: 200, code: verification.code ?? null, detail: verification.detail ?? null });
    }
  }

  return {
    nullifier: BigInt(proof.nullifier).toString(),
    level: 'proof_of_human',
  };
}
