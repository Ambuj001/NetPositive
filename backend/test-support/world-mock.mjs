// TESTS ONLY. Builds a v4-shaped IDKit result for a pending /world-id/request when WORLD_ID_MOCK=true.
import { hashSignal } from '@worldcoin/idkit-core/hashing';

export function mockResult({ request, nullifier }) {
  return {
    protocol_version: '4.0',
    nonce: request.rp_context.nonce,
    action: request.action,
    environment: request.environment,
    responses: [
      {
        identifier: 'proof_of_human',
        signal_hash: hashSignal(request.signal),
        proof: ['0x1', '0x2', '0x3', '0x4', '0x5'],
        nullifier: `0x${BigInt(nullifier).toString(16)}`,
        issuer_schema_id: 1,
        expires_at_min: Math.floor(Date.now() / 1000) + 3600,
      },
    ],
  };
}
