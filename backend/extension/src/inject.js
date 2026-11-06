// Runs in the PAGE's own JS world (manifest "world": "MAIN") so it can see the page's fetch/XHR.
// It only observes responses of the balance endpoint and hands them to the content script.
// It never clicks, never touches the CAPTCHA, and never sends anything over the network.
(() => {
  const TAG = 'netpositive:woohoo-balance';
  const isBalance = (url) => {
    try { return /(^|\/)balance(\/|$)/.test(new URL(url, location.href).pathname); } catch { return false; }
  };
  const post = (httpStatus, body) => window.postMessage({ tag: TAG, httpStatus, body }, location.origin);

  const origFetch = window.fetch;
  window.fetch = async function (...args) {
    const res = await origFetch.apply(this, args);
    try {
      const url = typeof args[0] === 'string' ? args[0] : args[0]?.url;
      if (isBalance(url)) res.clone().json().then((b) => post(res.status, b), () => post(res.status, null));
    } catch { /* never break the page */ }
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    if (isBalance(url)) {
      this.addEventListener('load', () => {
        try { post(this.status, JSON.parse(this.responseText)); } catch { post(this.status, null); }
      });
    }
    return origOpen.call(this, method, url, ...rest);
  };
})();
