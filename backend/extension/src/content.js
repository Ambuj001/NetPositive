// Isolated-world content script for woohoo.in/profile/check-balance.
// 1) Fills the card number + PIN the user gave the extension and presses the page's own "Check Balance".
// 2) Reads the balance response captured by inject.js and reports a normalised result.
// The code/PIN stay in this tab's memory and are dropped as soon as the result arrives.
(() => {
  const TAG = 'netpositive:woohoo-balance';
  const MAX_WAIT_MS = 10 * 60_000; // matches the background's code lifetime (covers a login in between)
  let pending = null;
  let filled = false;
  let loginReported = false;

  const setValue = (el, value) => {
    // Works with React/Formik-controlled inputs: focus, native setter, input/change, then blur.
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
    el.focus();
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    el.dispatchEvent(new Event('blur', { bubbles: true }));
  };
  const findInput = (needle) =>
    [...document.querySelectorAll('input')].find((i) => (i.placeholder || '').toLowerCase().includes(needle));
  const pageShowsFieldErrors = () => /must be at least|is required/i.test(document.body.innerText || '');
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function tryFill() {
    if (filled || !pending) return filled;
    const card = findInput('card number');
    const pin = findInput('pin');
    if (!card || !pin) {
      // Not logged in: the page shows a phone-number login instead of the card fields.
      if (!loginReported && findInput('phone')) {
        loginReported = true;
        chrome.runtime.sendMessage({ type: 'np:needsLogin' });
      }
      return false;
    }
    filled = true;
    chrome.runtime.sendMessage({ type: 'np:filled' });
    fillAndSubmit();
    return true;
  }

  // Fill, WAIT until the page has really accepted the values, then press its own "Check Balance".
  // Pressing too early made the page validate empty fields. If errors appear anyway, refill and retry.
  async function fillAndSubmit() {
    for (let attempt = 0; attempt < 4 && pending; attempt++) {
      const card = findInput('card number');
      const pin = findInput('pin');
      if (!card || !pin) { await sleep(500); continue; } // page re-rendered (e.g. after login)
      setValue(card, pending.code);
      setValue(pin, pending.pin ?? '');
      await sleep(600); // let the page's state catch up
      const c2 = findInput('card number');
      const p2 = findInput('pin');
      if (!c2 || !p2 || c2.value !== pending.code || p2.value !== (pending.pin ?? '')) continue; // wiped: retry
      const btn = [...document.querySelectorAll('button')].find((b) => /check balance/i.test(b.textContent || ''));
      if (!btn || btn.disabled) { await sleep(500); continue; }
      btn.click();
      await sleep(1800);
      if (!pending) return; // result arrived
      if (!pageShowsFieldErrors()) return; // submitted; now waiting for the response
    }
    if (pending) chrome.runtime.sendMessage({ type: 'np:needsUser' });
  }

  async function init() {
    const res = await chrome.runtime.sendMessage({ type: 'np:getPending' });
    pending = res?.pending ?? null;
    if (!pending || tryFill()) return;
    const obs = new MutationObserver(() => { if (tryFill()) obs.disconnect(); });
    obs.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(() => obs.disconnect(), MAX_WAIT_MS);
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const d = event.data;
    if (!d || d.tag !== TAG || !pending) return;
    const result = NP.normalizeWoohoo({ httpStatus: d.httpStatus, body: d.body }, pending.code);
    const verdict = NP.evaluate(result, { expectedPaise: pending.expectedPaise });
    pending = null; // drop the code + PIN
    chrome.runtime.sendMessage({ type: 'np:result', result, verdict, checkedAt: new Date().toISOString() });
  });

  init();
})();
