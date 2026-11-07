// TESTS ONLY. Builds a World ID v4 "IDKit result" that this backend's mock mode accepts (same shape scripts/smoke.js uses).
// Mock mode still checks rp_id, environment, action and that the signal is the signed-in wallet, so the wallet address is required.
import { hashSignal } from '@worldcoin/idkit-core/hashing';

/** Env vars a test process must set before importing the backend so World ID mock mode works. */
export const WORLD_ID_TEST_ENV = {
  WORLD_ID_APP_ID: 'app_staging_test',
  WORLD_ID_ACTION: 'netpositive-account', // pinned so a developer's local .env cannot change what the tests expect
  WORLD_ID_RP_ID: 'rp_test',
  WORLD_ID_SIGNING_KEY: 'ab'.repeat(32),
  WORLD_ID_ENV: 'staging',
  WORLD_ID_MOCK: 'true',
};

/** @param {{address: string, nullifier: bigint|number|string}} p  nullifier: any unique number; it identifies the "human". */
export function mockResult({ address, nullifier }) {
  const n = BigInt(nullifier);
  return {
    rp_id: WORLD_ID_TEST_ENV.WORLD_ID_RP_ID,
    idkitResponse: {
      protocol_version: '4.0',
      nonce: `nonce-${n}`,
      action: 'netpositive-account',
      environment: WORLD_ID_TEST_ENV.WORLD_ID_ENV,
      responses: [
        {
          identifier: 'proof_of_human',
          signal_hash: hashSignal(address.toLowerCase()),
          nullifier: `0x${n.toString(16).padStart(64, '0')}`,
          proof: ['1', '2', '3', '4', '5'],
          issuer_schema_id: 1,
          expires_at_min: 1,
        },
      ],
    },
  };
}
