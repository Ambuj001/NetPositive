/**
 * Firebase entry point (Cloud Functions, 2nd generation). `npm start` (src/index.js) is still the plain Node server.
 *
 *   api      the whole Express API behind one HTTPS function
 *   sweeper  every minute: timeouts and following the chain (what the in-process sweeper does on a plain server)
 *
 * Settings come from backend/.env.<projectId> (not secret) and from Secret Manager (the four secrets below).
 * The app is loaded on first use, not at import: Firebase imports this file at deploy time without any settings.
 */
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { defineSecret } from 'firebase-functions/params';

const SECRETS = ['JWT_SECRET', 'VOUCHER_ENC_KEY', 'WORLD_ID_SIGNING_KEY', 'ESCROW_KEEPER_PRIVATE_KEY'].map((name) => defineSecret(name));
const REGION = process.env.FUNCTIONS_REGION_NAME || 'asia-south1'; // Mumbai

function prepareEnv() {
  // Firebase reserves the FIREBASE_ prefix in .env files; the project id is provided by the runtime.
  process.env.FIREBASE_PROJECT_ID ||= process.env.GCLOUD_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || '';
  // Timeouts run in the scheduled function, never inside a request instance.
  process.env.SWEEP_INTERVAL_SECONDS = '0';
  process.env.RATES_REFRESH_SECONDS ||= '0';
  process.env.TRUST_PROXY ||= '1';
}

let app;
export const api = onRequest({ region: REGION, secrets: SECRETS, memory: '512MiB', timeoutSeconds: 120, concurrency: 80, maxInstances: 5, invoker: 'public' }, async (req, res) => {
  if (!app) {
    prepareEnv();
    app = (await import('./app.js')).createApp();
  }
  return app(req, res);
});

export const sweeper = onSchedule({ schedule: 'every 1 minutes', region: REGION, secrets: SECRETS, memory: '512MiB', timeoutSeconds: 300, maxInstances: 1, retryCount: 0 }, async () => {
  prepareEnv();
  const { sweep } = await import('./services/requests.js');
  const r = await sweep();
  if (r.reopened || r.autoReleased || r.reconciled || r.followedChain || r.errors) console.log('[sweeper]', JSON.stringify(r));
});
