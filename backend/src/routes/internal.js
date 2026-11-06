import { Router } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { config } from '../config.js';
import { sweep } from '../services/requests.js';
import { unauthorized, notFound } from '../lib/errors.js';

const router = Router();

function checkCronSecret(req) {
  if (!config.CRON_SECRET) throw notFound();
  const given = Buffer.from(req.get('x-cron-secret') ?? '');
  const expected = Buffer.from(config.CRON_SECRET);
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) throw unauthorized('Bad cron secret');
}

/** POST /internal/sweep  (header x-cron-secret) → process timeouts. For Cloud Scheduler / cron. */
router.post('/sweep', async (req, res) => {
  checkCronSecret(req);
  res.json(await sweep());
});

export default router;
