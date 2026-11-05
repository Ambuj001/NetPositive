import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { HttpError } from './lib/errors.js';
import authRoutes from './routes/auth.js';
import worldIdRoutes from './routes/worldid.js';
import requestRoutes from './routes/requests.js';
import internalRoutes from './routes/internal.js';

export function createApp() {
  const app = express();
  app.disable('x-powered-by');
  app.use(cors({ origin: config.CORS_ORIGINS.length ? config.CORS_ORIGINS : false }));
  app.use(express.json({ limit: '32kb' }));

  app.get('/health', (_req, res) => res.json({ ok: true, escrowMode: config.ESCROW_MODE, worldIdMock: config.WORLD_ID_MOCK }));

  app.use('/auth', authRoutes);
  app.use('/world-id', worldIdRoutes);
  app.use('/requests', requestRoutes);
  app.use('/internal', internalRoutes);

  app.use((_req, _res, next) => next(new HttpError(404, 'not_found', 'Route not found')));

  // Express 5 forwards rejected async handlers here automatically.
  app.use((err, _req, res, _next) => {
    if (err instanceof HttpError) {
      return res.status(err.status).json({ error: err.code, message: err.message, details: err.details });
    }
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'invalid_json', message: 'Malformed JSON body' });
    }
    if (err.type === 'entity.too.large') {
      return res.status(413).json({ error: 'payload_too_large', message: 'Request body is too large' });
    }
    console.error(err);
    res.status(500).json({ error: 'internal_error', message: 'Something went wrong' });
  });

  return app;
}
