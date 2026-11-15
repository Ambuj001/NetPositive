import { config } from '../config.js';

/**
 * Response headers for a JSON API: nothing here is meant to be framed, sniffed or cached by a shared cache.
 */
export function securityHeaders(_req, res, next) {
  res.set({
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'no-referrer',
    'Cross-Origin-Resource-Policy': 'cross-origin', // the web app is on another origin and reads these responses
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  });
  if (config.NODE_ENV === 'production') res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
}

/**
 * Fixed-window rate limit per client address, kept in memory (per instance: with several instances each allows the
 * limit, which is acceptable as a flood guard; it is not an exact quota).
 * `limit` 0 turns it off. `key` separates buckets (for example reads and writes).
 */
export function rateLimit({ limit, windowMs = 60_000, key = 'all' }) {
  if (!limit) return (_req, _res, next) => next();
  const hits = new Map();
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [k, v] of hits) if (v.resetAt <= now) hits.delete(k);
  }, windowMs);
  timer.unref();
  return (req, res, next) => {
    const id = `${key}:${req.ip}`;
    const now = Date.now();
    let entry = hits.get(id);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      hits.set(id, entry);
    }
    entry.count += 1;
    res.set('RateLimit-Limit', String(limit));
    res.set('RateLimit-Remaining', String(Math.max(0, limit - entry.count)));
    if (entry.count > limit) {
      const retry = Math.ceil((entry.resetAt - now) / 1000);
      res.set('Retry-After', String(retry));
      return res.status(429).json({ error: 'rate_limited', message: `Too many requests. Try again in ${retry} seconds.` });
    }
    next();
  };
}

/** One JSON line per request: enough to trace a complaint, with no bodies, tokens or voucher data. */
export function requestLog(req, res, next) {
  if (!config.REQUEST_LOG || req.path === '/health') return next();
  const started = process.hrtime.bigint();
  res.on('finish', () => {
    const ms = Number((process.hrtime.bigint() - started) / 1_000_000n);
    console.log(JSON.stringify({
      t: new Date().toISOString(),
      method: req.method,
      path: req.baseUrl + req.path,
      status: res.statusCode,
      ms,
      ip: req.ip,
      user: req.user?.address ?? null,
    }));
  });
  next();
}
