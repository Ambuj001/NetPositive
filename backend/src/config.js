import 'dotenv/config';
import { z } from 'zod';

const bool = z
  .string()
  .optional()
  .transform((v) => v === 'true' || v === '1');

const csv = z
  .string()
  .optional()
  .transform((v) =>
    (v ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  );

// viem's privateKeyToAccount slices off a leading "0x". A bare 64-char hex key loses its first byte.
const hexPrivateKey = (message) =>
  z
    .string()
    .optional()
    .default('')
    .transform((v) => v.trim())
    .refine((v) => v === '' || /^(0x)?[0-9a-fA-F]{64}$/.test(v), message)
    .transform((v) => (v ? `0x${v.replace(/^0x/i, '')}` : ''));

const schema = z.object({
  PORT: z.coerce.number().int().default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGINS: csv,

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL: z.string().default('12h'),
  VOUCHER_ENC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'VOUCHER_ENC_KEY must be 64 hex chars (32 bytes)'),
  // How voucher codes may be submitted: 'sealed' = only client-side-encrypted envelopes (server never sees a code),
  // 'legacy' = plaintext over TLS, encrypted at rest with VOUCHER_ENC_KEY, 'both' = either (migration).
  VOUCHER_MODE: z.enum(['legacy', 'both', 'sealed']).default('both'),
  // Optional X25519 public key (64 hex) of the offline dispute key. If set, sealed vouchers must also be sealed to it.
  ADMIN_VAULT_PUBLIC_KEY: z.string().regex(/^([0-9a-fA-F]{64})?$/, 'ADMIN_VAULT_PUBLIC_KEY must be 64 hex chars').optional().default('').transform((v) => v.toLowerCase()),
  ADMIN_ADDRESSES: csv.transform((list) => list.map((a) => a.toLowerCase())),
  CRON_SECRET: z.string().optional().default(''),
  SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),

  FULFIL_WINDOW_MINUTES: z.coerce.number().positive().default(30),
  REVIEW_WINDOW_MINUTES: z.coerce.number().positive().default(60),

  // Dispute: the person raising it stakes this much USDC (same escrow contract). "0" turns the stake off.
  // Judged right -> stake returned. Judged wrong -> stake goes to the other party and the account is banned.
  // Local mock only. VoucherEscrowV2 cannot hold a stake, so this must stay "0" when ESCROW_MODE=chain.
  DISPUTE_BOND_USDC: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Decimal string, e.g. "1" or "0.5"').default('0'),
  DISPUTE_MAX_EVIDENCE_PER_PARTY: z.coerce.number().int().min(0).max(10).default(4),
  DISPUTE_MAX_IMAGE_BYTES: z.coerce.number().int().min(10_000).max(700_000).default(500_000),

  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  FIRESTORE_EMULATOR_HOST: z.string().optional().default(''),

  WORLD_ID_APP_ID: z.string().min(1),
  WORLD_ID_RP_ID: z.string().default(''),
  WORLD_ID_SIGNING_KEY: z
    .string()
    .default('')
    .refine((v) => v === '' || /^(0x)?[0-9a-fA-F]{64}$/.test(v), 'WORLD_ID_SIGNING_KEY must be 32 bytes of hex'),
  WORLD_ID_ACTION: z.string().min(1).default('netpositive-account'),
  WORLD_ID_ENV: z.enum(['production', 'staging', 'sandbox']).optional(),
  // Base of POST /api/v4/verify/{rp_id}. A leftover v2 URL is rewritten in the service.
  WORLD_ID_VERIFY_URL: z.string().url().default('https://developer.world.org/api/v4/verify'),
  WORLD_ID_MOCK: bool,
  // LOCAL DEVELOPMENT ONLY. Skips World ID entirely: /world-id/verify marks the signed-in wallet as a verified human with its
  // own fake identity (derived from the wallet), so every test wallet can register. Refused in production (see below).
  WORLD_ID_DEV_BYPASS: bool,

  ESCROW_MODE: z.enum(['chain', 'mock']).default('mock'),
  // Arc mainnet: chain 5042, https://rpc.mainnet.arc.io. Arc testnet (the default): chain 5042002.
  ARC_RPC_URL: z.string().url().default('https://rpc.testnet.arc.io'),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  // USDC's ERC-20 address is the same on Arc mainnet and testnet.
  USDC_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default('0x3600000000000000000000000000000000000000'),
  // CodeMailbox on Arc testnet (contracts/private-transfer). Its EIP-712 domain is what the spender's "Ready" permit is signed for.
  CODE_MAILBOX_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default('0xA8243e92A89de7F62D3023EB68EEB4f4e40e88B1'),
  ESCROW_CONTRACT_ADDRESS: z.string().optional().default(''),
  // VoucherEscrowV2. The keeper key has NO role in the contract: it only pays gas for calls anyone may send
  // (claim after the review window, refund after expiry). The arbiter key can only split escrows the spender has put
  // in dispute; leave it empty to have the arbiter rule from their own wallet or multisig.
  ESCROW_KEEPER_PRIVATE_KEY: hexPrivateKey('ESCROW_KEEPER_PRIVATE_KEY must be 32 bytes of hex'),
  ESCROW_ARBITER_PRIVATE_KEY: hexPrivateKey('ESCROW_ARBITER_PRIVATE_KEY must be 32 bytes of hex'),
  // How long a funded order stays open for a buyer (the `ttl` passed to deposit). The contract allows 1 hour to 30 days.
  ESCROW_ORDER_TTL_SECONDS: z.coerce.number().int().min(3600).max(30 * 86400).default(3 * 86400),
  // Mock escrow only: the fee the real contract would report through quoteFee().
  ESCROW_MOCK_FEE_BPS: z.coerce.number().int().min(0).max(500).default(100),
  USDC_DECIMALS: z.coerce.number().int().default(6),
  // Signs /rates/attestation when RATES_SIGNER_PRIVATE_KEY is empty (first key is used).
  ATTESTOR_PRIVATE_KEYS: csv,
  // ---------- Live rates (/rates) ----------
  // Comma list to restrict sources (default: all): coinbase,frankfurter,erapi,pyth,wazirx,coindcx,binance,bybit,kucoin
  RATES_SOURCES: csv,
  RATES_REFRESH_SECONDS: z.coerce.number().int().min(0).default(60), // background snapshot for /rates/history (0 = off)
  RATES_P2P_TTL_SECONDS: z.coerce.number().int().min(1).default(30),
  RATES_MAX_STALE_SECONDS: z.coerce.number().int().min(0).default(900), // serve last good value this long if all sources fail
  RATES_OUTLIER_PCT: z.coerce.number().positive().default(3), // drop a source this far from the cross-source median
  RATES_DEFAULT_AMOUNT_INR: z.coerce.number().int().positive().default(10_000),
  P2P_MIN_COMPLETION: z.coerce.number().min(0).max(1).default(0.9),
  P2P_MIN_ORDERS: z.coerce.number().int().min(0).default(20),
  RATES_SIGNER_PRIVATE_KEY: z.string().optional().default(''), // signs /rates/attestation; default: first attestor key
  PYTH_API_KEY: z.string().optional().default(''),
});

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:');
  for (const issue of parsed.error.issues) {
    console.error(`  ${issue.path.join('.')}: ${issue.message}`);
  }
  process.exit(1);
}

export const config = {
  ...parsed.data,
  WORLD_ID_ENV: parsed.data.WORLD_ID_ENV ?? (parsed.data.NODE_ENV === 'production' ? 'production' : 'staging'),
};

// Guard rails: dev shortcuts must never reach production.
if (config.NODE_ENV === 'production') {
  if (config.ESCROW_MODE === 'mock') {
    console.error('ESCROW_MODE=mock is not allowed in production.');
    process.exit(1);
  }
  if (config.WORLD_ID_MOCK) {
    console.error('WORLD_ID_MOCK=true is not allowed in production.');
    process.exit(1);
  }
  if (config.WORLD_ID_ENV !== 'production') {
    console.error('WORLD_ID_ENV must be production when NODE_ENV=production.');
    process.exit(1);
  }
}
// The bypass is also refused whenever World ID is pointed at production, whatever NODE_ENV says.
if (config.WORLD_ID_DEV_BYPASS && (config.NODE_ENV === 'production' || config.WORLD_ID_ENV === 'production')) {
  console.error('WORLD_ID_DEV_BYPASS=true is not allowed in production (NODE_ENV or WORLD_ID_ENV is production).');
  process.exit(1);
}
if (config.WORLD_ID_DEV_BYPASS) console.warn('[world-id] WORLD_ID_DEV_BYPASS=true: World ID checks are OFF. Local development only.');

if (config.ESCROW_MODE === 'chain') {
  const missing = ['ESCROW_CONTRACT_ADDRESS', 'ESCROW_KEEPER_PRIVATE_KEY'].filter((k) => !config[k]);
  if (missing.length) {
    console.error(`ESCROW_MODE=chain requires: ${missing.join(', ')}`);
    process.exit(1);
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(config.ESCROW_CONTRACT_ADDRESS)) {
    console.error('ESCROW_CONTRACT_ADDRESS must be a 20-byte hex address.');
    process.exit(1);
  }
  if (Number(config.DISPUTE_BOND_USDC) !== 0) {
    console.error('DISPUTE_BOND_USDC must be 0 when ESCROW_MODE=chain: the V2 escrow cannot hold a dispute stake.');
    process.exit(1);
  }
  if (config.ESCROW_ARBITER_PRIVATE_KEY && config.ESCROW_ARBITER_PRIVATE_KEY === config.ESCROW_KEEPER_PRIVATE_KEY) {
    console.error('ESCROW_KEEPER_PRIVATE_KEY and ESCROW_ARBITER_PRIVATE_KEY must be different keys.');
    process.exit(1);
  }
  if (!config.ESCROW_ARBITER_PRIVATE_KEY) console.warn('[escrow] No ESCROW_ARBITER_PRIVATE_KEY: disputes must be resolved by the arbiter from their own wallet.');
}

// Supported voucher brands. Extend as gift-card coverage grows.
export const BRANDS = ['amazon', 'flipkart', 'swiggy', 'zomato', 'myntra', 'bigbasket', 'makemytrip', 'blinkit'];
