// Pure helpers for the login round-trip (no browser APIs, unit-tested).
(function (root) {
  const CHECK_PATH = /\/profile\/check-balance/;
  // Paths that look like part of a login / OTP step: don't navigate away from these.
  const AUTH_PATH = /login|otp|verify|auth|sign[-_ ]?in|sign[-_ ]?up|register/i;

  const isWoohoo = (host) => host === 'woohoo.in' || host.endsWith('.woohoo.in');

  function isCheckPage(url) {
    try { const u = new URL(url); return isWoohoo(u.hostname) && CHECK_PATH.test(u.pathname); } catch { return false; }
  }

  /**
   * After a login redirect, decide whether the tab has landed somewhere that means "logged in now",
   * i.e. we should send it back to the check page. loginPath is where Woohoo first sent the user.
   */
  function shouldReturnToCheck(url, loginPath) {
    try {
      const u = new URL(url);
      if (!isWoohoo(u.hostname) || CHECK_PATH.test(u.pathname)) return false;
      if (loginPath && u.pathname === loginPath) return false;
      return !AUTH_PATH.test(u.pathname);
    } catch { return false; }
  }

  const api = { isCheckPage, shouldReturnToCheck };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.NP = Object.assign(root.NP ?? {}, api);
})(typeof globalThis !== 'undefined' ? globalThis : this);
