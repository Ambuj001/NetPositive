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
  DISPUTE_BOND_USDC: z.string().regex(/^\d+(\.\d{1,6})?$/, 'Decimal string, e.g. "1" or "0.5"').default('1'),
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
  ARC_RPC_URL: z.string().url().default('https://rpc.testnet.arc.network'),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  // CodeMailbox on Arc testnet (contracts/private-transfer). Its EIP-712 domain is what the spender's "Ready" permit is signed for.
  CODE_MAILBOX_ADDRESS: z.string().regex(/^0x[0-9a-fA-F]{40}$/).default('0xA8243e92A89de7F62D3023EB68EEB4f4e40e88B1'),
  ESCROW_CONTRACT_ADDRESS: z.string().optional().default(''),
  ESCROW_OPERATOR_PRIVATE_KEY: hexPrivateKey('ESCROW_OPERATOR_PRIVATE_KEY must be 32 bytes of hex'),
  USDC_DECIMALS: z.coerce.number().int().default(6),
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
  const missing = ['ESCROW_CONTRACT_ADDRESS', 'ESCROW_OPERATOR_PRIVATE_KEY'].filter((k) => !config[k]);
  if (missing.length) {
    console.error(`ESCROW_MODE=chain requires: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// Supported voucher brands. Extend as gift-card coverage grows.
export const BRANDS = ['amazon', 'flipkart', 'swiggy', 'zomato', 'myntra', 'bigbasket', 'makemytrip', 'blinkit'];
