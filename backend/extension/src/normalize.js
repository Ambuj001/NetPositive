// Pure logic: turn a Woohoo `balance` response into our standard result, then judge it.
// Loaded as a plain script by the extension (attaches to globalThis.NP) and via require() in tests.
// Fails closed: anything unexpected is "not valid".
(function (root) {
  const MS_PER_DAY = 86_400_000;

  /** "1000.00" -> 100000 (integer paise). Never uses floats. Returns null if malformed. */
  function toPaise(value) {
    const s = String(value ?? '').trim();
    const m = /^(\d+)(?:\.(\d{1,2}))?$/.exec(s);
    if (!m) return null;
    return Number(m[1]) * 100 + Number((m[2] ?? '').padEnd(2, '0') || '0');
  }

  /**
   * Compare the (possibly masked, e.g. 60148805xxx589729) card number in the response with the
   * code we were asked to check. 'match' | 'mismatch' | 'unknown'.
   */
  function bindCard(responseNumber, code) {
    const a = String(responseNumber ?? '').replace(/[\s-]/g, '').toLowerCase();
    const b = String(code ?? '').replace(/[\s-]/g, '').toLowerCase();
    if (!a || !b) return 'unknown';
    const first = a.search(/[x*]/);
    if (first === -1) return a === b ? 'match' : 'mismatch'; // unmasked: must be identical
    // Masked: the visible leading and trailing digits must match the code (mask length may vary).
    const last = Math.max(a.lastIndexOf('x'), a.lastIndexOf('*'));
    const head = a.slice(0, first);
    const tail = a.slice(last + 1);
    if (b.length < head.length + tail.length) return 'mismatch';
    return b.startsWith(head) && b.endsWith(tail) ? 'match' : 'mismatch';
  }

  /**
   * raw: { httpStatus, body } as captured from the page. code: what the user asked us to check.
   * Returns { brand, ok, status, balancePaise, currency, expiresAt, maskedCard, binding, reason? }.
   * The code/PIN is never copied into the result.
   */
  function normalizeWoohoo(raw, code) {
    const base = { brand: 'woohoo', ok: false, status: 'UNKNOWN', balancePaise: null, currency: null, expiresAt: null, maskedCard: null, binding: 'unknown' };
    const body = raw && raw.body;
    if (!raw || raw.httpStatus < 200 || raw.httpStatus >= 300 || !body || typeof body !== 'object') {
      return { ...base, reason: 'no_valid_response' };
    }
    const responseCode = body.additionalTxnFields?.responseCode;
    const status = typeof body.status === 'string' ? body.status.toUpperCase() : 'UNKNOWN';
    const balancePaise = toPaise(body.balance);
    const expiry = body.expiry ? Date.parse(body.expiry) : NaN;
    const result = {
      ...base,
      status,
      balancePaise,
      currency: body.currency?.code ?? null,
      expiresAt: Number.isNaN(expiry) ? null : new Date(expiry).toISOString(),
      maskedCard: typeof body.cardNumber === 'string' ? body.cardNumber : null,
      binding: bindCard(body.cardNumber, code),
    };
    if (responseCode !== 0) return { ...result, reason: 'issuer_error' };
    if (balancePaise === null) return { ...result, reason: 'bad_balance' };
    return { ...result, ok: true };
  }

  /**
   * Decide whether the voucher is acceptable for an order.
   * opts: { expectedPaise?, minDaysToExpiry = 30, now = Date.now() }
   * Returns { valid, failures: string[] }.
   */
  function evaluate(result, opts = {}) {
    const { expectedPaise, minDaysToExpiry = 30, now = Date.now() } = opts;
    const failures = [];
    if (!result.ok) failures.push(result.reason ?? 'check_failed');
    else {
      if (result.status !== 'ACTIVATED') failures.push(`status_${result.status.toLowerCase()}`);
      if (result.currency !== 'INR') failures.push('wrong_currency');
      if (result.binding === 'mismatch') failures.push('card_mismatch');
      if (expectedPaise != null && result.balancePaise < expectedPaise) failures.push('balance_too_low');
      if (!result.expiresAt) failures.push('no_expiry');
      else if (Date.parse(result.expiresAt) - now < minDaysToExpiry * MS_PER_DAY) failures.push('expires_too_soon');
    }
    return { valid: failures.length === 0, failures };
  }

  const api = { toPaise, bindCard, normalizeWoohoo, evaluate };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NP = Object.assign(root.NP ?? {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
