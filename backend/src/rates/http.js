// HTTP for rate sources: timeout, one retry with jitter, and a per-source circuit breaker
// (after 3 straight failures a source is skipped for 60 s, so one dead exchange can't slow every request).

let fetchImpl = (...a) => globalThis.fetch(...a);
/** Tests inject a fake fetch here. */
export const setFetch = (fn) => { fetchImpl = fn; };

const UA = 'NetPositive-rates/1.0 (+https://github.com/Ambuj001/NetPositive)';
const breakers = new Map(); // source -> { fails, openUntil, lastError, lastOkAt, lastLatencyMs }

export function sourceHealth() {
  return Object.fromEntries([...breakers.entries()].map(([k, b]) => [k, {
    ok: b.fails === 0,
    consecutiveFailures: b.fails,
    circuitOpenUntil: b.openUntil > Date.now() ? new Date(b.openUntil).toISOString() : null,
    lastOkAt: b.lastOkAt ? new Date(b.lastOkAt).toISOString() : null,
    lastError: b.lastError,
    lastLatencyMs: b.lastLatencyMs,
  }]));
}

export const resetBreakers = () => breakers.clear();

export async function fetchJson(source, url, { method = 'GET', body, headers = {}, timeoutMs = 6000, retries = 1 } = {}) {
  const b = breakers.get(source) ?? { fails: 0, openUntil: 0, lastError: null, lastOkAt: null, lastLatencyMs: null };
  breakers.set(source, b);
  if (b.openUntil > Date.now()) throw new Error(`${source}: circuit open (${b.lastError})`);

  let lastErr;
  for (let attempt = 0; attempt <= retries; attempt++) {
    const t0 = Date.now();
    try {
      const res = await fetchImpl(url, {
        method,
        headers: { accept: 'application/json', 'user-agent': UA, ...(body && { 'content-type': 'application/json' }), ...headers },
        body: body && JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      b.fails = 0; b.lastOkAt = Date.now(); b.lastLatencyMs = Date.now() - t0; b.lastError = null;
      return json;
    } catch (err) {
      lastErr = err;
      if (attempt < retries) await new Promise((r) => setTimeout(r, 150 + Math.random() * 250));
    }
  }
  b.fails += 1;
  b.lastError = String(lastErr?.message ?? lastErr).slice(0, 200);
  if (b.fails >= 3) b.openUntil = Date.now() + 60_000;
  throw new Error(`${source}: ${b.lastError}`);
}
