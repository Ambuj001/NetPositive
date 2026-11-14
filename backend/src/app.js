import { randomBytes } from 'node:crypto';
import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import { worldIdReady } from './services/worldid.js';
import authRoutes from './routes/auth.js';
import worldIdRoutes from './routes/worldid.js';
import requestRoutes from './routes/requests.js';
import disputeRoutes from './routes/disputes.js';
import cardRoutes from './routes/cards.js';
import vaultRoutes from './routes/vault.js';
import buyIntentRoutes from './routes/buyIntents.js';
import internalRoutes from './routes/internal.js';
import ratesRoutes from './routes/rates.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false }));
  app.use(express.json({ limit: '256kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, escrowMode: config.ESCROW_MODE, escrowVersion: 2, worldIdMock: config.WORLD_ID_MOCK, worldIdBypass: config.WORLD_ID_DEV_BYPASS, worldIdReady: worldIdReady(), chainId: config.ARC_CHAIN_ID, escrowContract: config.ESCROW_MODE === 'chain' ? config.ESCROW_CONTRACT_ADDRESS : null }));

  app.use('/auth', authRoutes);
  app.use('/world-id', worldIdRoutes);
  app.use('/requests', disputeRoutes); // before requestRoutes: owns /:id/dispute*, /:id/evidence*, /:id/resolve
  app.use('/requests', requestRoutes);
  app.use('/buy-intents', buyIntentRoutes);
  app.use('/cards', cardRoutes);
  app.use('/vault', vaultRoutes);
  app.use('/internal', internalRoutes);
  app.use('/rates', ratesRoutes);

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Route not found')));

  // Express 5 forwards rejected async handlers here automatically.
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large', message: 'Request body is too large' });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'Malformed JSON body' });
    }
    // A short reference ties what the person sees to this log line, so "it failed" can be traced to the cause.
    const ref = randomBytes(4).toString('hex');
    console.error(`[error ${ref}] ${_req.method} ${_req.originalUrl}:`, err);
    res.status(500).json({ error: 'internal_error', message: `The server hit an unexpected error (ref ${ref}).`, details: { ref } });
  });

  return app;
}
