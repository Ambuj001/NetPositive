# NetPositive Voucher Check (browser extension)

Checks a **Woohoo** voucher in the user's *own* browser session and reports balance, status and expiry.
The card number and PIN never leave the device: no server, no analytics, no network calls from the extension.

## Who uses it

The **seller of crypto** (the requester, the person who bears the risk). After the buyer submits the code, the seller reveals it in the app
(`GET /requests/:id/voucher`), checks it here in their own browser, then confirms (releases the crypto) or disputes. No Woohoo API is needed.
The chatbot gives the steps: `POST /request/verify_guide` / tool `verify_received_voucher`.

## How it works

1. The extension opens as a **side panel** (click the toolbar icon, like MetaMask). It takes the card number, PIN and an optional expected amount, then opens `woohoo.in/profile/check-balance` in a **background tab** (the user stays in the side panel).
2. The content script fills the two fields and presses the page's own **Check Balance** button. Woohoo's own reCAPTCHA runs untouched in the user's real browser.
3. `inject.js` (page world) observes the page's own `balance` response. `normalize.js` turns it into a standard result and judges it.
4. The side panel shows ✓ Valid or ✗ Not valid with reasons.

The extension does not solve or bypass the CAPTCHA, fake tokens, or call Woohoo's API itself.
If Woohoo needs a login, the tab is brought to the front. After the user logs in, the extension sends the tab back to the
check page, finishes the check, closes the tab, returns the user to the page they were on, and shows the result
(live in the side panel, plus a ✓/✗ badge if the panel is closed). The code is kept in session memory (never disk) for up to 10 minutes for this,
and is dropped on result, on closing the Woohoo tab, or on timeout.
A visible challenge or a response slower than 45 s also brings the tab forward.

## Validity rules (fail closed)

Valid only if: HTTP 2xx, `responseCode` 0, `status` is `ACTIVATED`, currency `INR`, balance ≥ expected (if given),
expiry ≥ 30 days away, and the card number in the response matches the one entered (swap protection).

## Run it

```
cd backend/extension
npm test                       # unit tests (no browser needed)
```

Load in Chrome / Brave: `chrome://extensions` → Developer mode → **Load unpacked** → select `backend/extension`.
Log in to woohoo.in, click the toolbar icon (side panel opens), enter a voucher and press **Check voucher**. The result appears in the panel.

## Honest limits

- Only the **success** response is from a real capture (6 Nov 2026). Error / spent / expired responses are **not yet captured**;
  the tests for those are synthetic and only prove we fail closed. Capture real ones and replace them.
- Woohoo's response has **no brand field**, so this proves "a live ₹X Woohoo card", not "a Lifestyle voucher".
- The result is only as trustworthy as the user's browser: a user can tamper with their own page. It is meant for the
  **buyer checking their own voucher**, not for a seller to prove anything to someone else. (zkTLS would fix that; not built.)
- This is a real check of one brand. Other brands need their own adapter.
- Running in a background tab is untested against Woohoo's reCAPTCHA scoring; if it blocks hidden tabs the tab is brought forward after 45 s.
- **The login round-trip is untested.** "Logged in" is detected by the tab landing on a woohoo.in page whose path is not the login path and doesn't look like login/OTP/verify. If Woohoo behaves differently (e.g. the login lands on the same path as before), the check falls back to the 5-minute timeout. Verify with a logged-out profile.
- Re-opening a closed side panel needs a user gesture, so it may be refused; the ✓/✗ badge is the fallback. Requires Chrome 116+ (side panel API); not tested in Brave.
- Selectors are by placeholder text ("card number", "pin") and the endpoint by path `/balance`; if Woohoo changes either, update `content.js` / `inject.js`.
