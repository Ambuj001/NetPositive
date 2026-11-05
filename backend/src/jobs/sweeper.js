import { config } from '../config.js';
import { sweep } from '../services/requests.js';

/** In-process timer for timeouts. With several instances, prefer POST /internal/sweep from one cron. */
export function startSweeper() {
  if (!config.SWEEP_INTERVAL_SECONDS) return () => {};
  let running = false;
  const timer = setInterval(async () => {
    if (running) return;
    running = true;
    try {
      const r = await sweep();
      if (r.reopened || r.autoReleased || r.reconciled || r.errors) console.log('[sweeper]', r);
    } catch (err) {
      console.error('[sweeper] failed:', err.message);
    } finally {
      running = false;
    }
  }, config.SWEEP_INTERVAL_SECONDS * 1000);
  timer.unref();
  return () => clearInterval(timer);
}
