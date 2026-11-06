const $ = (id) => document.getElementById(id);
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2 })}`;
const REASONS = {
  no_valid_response: 'Woohoo returned no valid response (wrong number/PIN, or not logged in).',
  issuer_error: 'Woohoo reported an error for this card.',
  bad_balance: 'Balance was in an unexpected format.',
  wrong_currency: 'Not an INR voucher.',
  card_mismatch: 'Woohoo answered for a different card number than the one entered.',
  balance_too_low: 'Balance is lower than the expected amount.',
  no_expiry: 'No expiry date returned.',
  expires_too_soon: 'Expires in under 30 days.',
};
const reasonText = (f) => REASONS[f] ?? (f.startsWith('status_') ? `Card status is ${f.slice(7).toUpperCase()}, not ACTIVATED.` : f);

function render(data) {
  const out = $('out');
  if (!data) { out.style.display = 'none'; return; }
  const { result, verdict } = data;
  out.style.display = 'block';
  out.className = verdict.valid ? 'ok' : 'bad';
  const lines = [];
  if (result.balancePaise != null) lines.push(`Balance: ${rupees(result.balancePaise)} · ${result.status}`);
  if (result.expiresAt) lines.push(`Expires: ${new Date(result.expiresAt).toLocaleDateString('en-IN')}`);
  if (result.maskedCard) lines.push(`Card: ${result.maskedCard}`);
  // textContent only: values come from a third-party page, never inject them as HTML.
  out.replaceChildren();
  const head = document.createElement('b');
  head.textContent = verdict.valid ? '✓ Valid voucher' : '✗ Not valid';
  out.append(head);
  const add = (text) => { const d = document.createElement('div'); d.textContent = text; out.append(d); };
  if (!verdict.valid) verdict.failures.forEach((f) => add(`• ${reasonText(f)}`));
  lines.forEach(add);
}

$('f').addEventListener('submit', async (e) => {
  e.preventDefault();
  const amtText = $('amt').value.trim().replace(/[,₹\s]/g, '');
  const expectedPaise = amtText ? NP.toPaise(amtText) : null;
  if (amtText && expectedPaise === null) { alert('Enter the amount as a plain number, e.g. 5000'); return; }
  await chrome.runtime.sendMessage({ type: 'np:start', code: $('code').value.trim(), pin: $('pin').value.trim(), expectedPaise });
  $('code').value = ''; $('pin').value = ''; // don't keep the secret in the popup
  render(null);
  showStatus({ state: 'checking' });
});

chrome.action.setBadgeText({ text: '' }); // result has been seen

const STATUS_TEXT = {
  checking: 'Checking on Woohoo…',
  needs_login: 'Log in to Woohoo in the tab that just opened. We will take you back and finish the check automatically.',
  needs_user: 'Woohoo needs you to finish in its tab (a verification step or a slow response).',
  cancelled: 'Cancelled: the Woohoo tab was closed. Enter the voucher again to retry.',
  expired: 'Timed out after 10 minutes and the code was discarded. Enter the voucher again to retry.',
};
function showStatus(status) {
  const el = $('status');
  const text = status && STATUS_TEXT[status.state];
  el.style.display = text ? 'block' : 'none';
  el.textContent = text ?? '';
  $('go').disabled = status?.state === 'checking';
}

chrome.storage.session.get(['result', 'status']).then(({ result, status }) => { render(result); showStatus(status); });
chrome.storage.onChanged.addListener((c, area) => {
  if (area !== 'session') return;
  if (c.result) { render(c.result.newValue); chrome.action.setBadgeText({ text: '' }); } // panel is open: no badge needed
  if (c.status) showStatus(c.status.newValue);
});
