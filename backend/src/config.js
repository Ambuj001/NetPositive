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

const schema = z.object({
  PORT: z.coerce.number().int().default(8080),
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  CORS_ORIGINS: csv,

  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_TTL: z.string().default('12h'),
  VOUCHER_ENC_KEY: z.string().regex(/^[0-9a-fA-F]{64}$/, 'VOUCHER_ENC_KEY must be 64 hex chars (32 bytes)'),
  ADMIN_ADDRESSES: csv.transform((list) => list.map((a) => a.toLowerCase())),
  CRON_SECRET: z.string().optional().default(''),
  SWEEP_INTERVAL_SECONDS: z.coerce.number().int().min(0).default(60),

  FULFIL_WINDOW_MINUTES: z.coerce.number().positive().default(30),
  REVIEW_WINDOW_MINUTES: z.coerce.number().positive().default(60),

  FIREBASE_PROJECT_ID: z.string().min(1),
  FIREBASE_SERVICE_ACCOUNT_JSON: z.string().optional().default(''),
  FIRESTORE_EMULATOR_HOST: z.string().optional().default(''),

  WORLD_ID_APP_ID: z.string().min(1),
  WORLD_ID_ACTION: z.string().min(1).default('netpositive-account'),
  WORLD_ID_VERIFY_URL: z.string().url().default('https://developer.worldcoin.org/api/v2/verify'),
  WORLD_ID_MIN_LEVEL: z.enum(['orb', 'device']).default('orb'),
  WORLD_ID_MOCK: bool,

  ESCROW_MODE: z.enum(['chain', 'mock']).default('mock'),
  ARC_RPC_URL: z.string().url().default('https://rpc.testnet.arc.network'),
  ARC_CHAIN_ID: z.coerce.number().int().default(5042002),
  ESCROW_CONTRACT_ADDRESS: z.string().optional().default(''),
  ESCROW_OPERATOR_PRIVATE_KEY: z.string().optional().default(''),
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

export const config = parsed.data;

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
}

if (config.ESCROW_MODE === 'chain') {
  const missing = ['ESCROW_CONTRACT_ADDRESS', 'ESCROW_OPERATOR_PRIVATE_KEY'].filter((k) => !config[k]);
  if (missing.length) {
    console.error(`ESCROW_MODE=chain requires: ${missing.join(', ')}`);
    process.exit(1);
  }
}

// Supported voucher brands. Extend as gift-card coverage grows.
export const BRANDS = ['amazon', 'flipkart', 'swiggy', 'zomato', 'myntra', 'bigbasket', 'makemytrip'];
