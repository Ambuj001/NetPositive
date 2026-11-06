import { useRef, useState } from 'react';
import { IDKitRequestWidget, proofOfHuman } from '@worldcoin/idkit';
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts';

// Guided test: a used voucher is sold, the buyer disputes, the arbitrator rules, and the HUMAN behind the seller is banned.
// Roles (throwaway in-browser wallets except the admin, who signs with MetaMask):
//   requester  = locks USDC (a different human)           fulfiller = hands over the used voucher (gets banned)
//   evader     = a brand-new wallet the banned person tries next      admin = the arbitrator (MetaMask)
// Needs the backend started with ESCROW_MODE=mock and ADMIN_ADDRESSES=<admin address below>.

const ADMIN = (new URLSearchParams(location.search).get('admin') ?? '0x9f06e1ae5105472100c95152aad07e9a300111b8').toLowerCase();
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');
const fakeTx = () => `0x${[...crypto.getRandomValues(new Uint8Array(32))].map((b) => b.toString(16).padStart(2, '0')).join('')}`;

async function api(path, { token, body } = {}) {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { ok: res.ok, status: res.status, json: await res.json().catch(() => ({})) };
}

const ROLES = [
  { id: 'fulfiller', label: 'Fulfiller (sells the used voucher)', human: 'identity A' },
  { id: 'requester', label: 'Requester (locks USDC, disputes)', human: 'identity B (a different person)' },
  { id: 'evader', label: 'Evader (new wallet of the banned person)', human: 'identity A again' },
  { id: 'admin', label: 'Admin / arbitrator (MetaMask)', human: 'no World ID needed' },
];

function loadKeys() {
  try { return JSON.parse(sessionStorage.getItem('np-test-keys') ?? '{}'); } catch { return {}; }
}

export default function DisputeTest() {
  const keys = useRef(loadKeys());
  const [sessions, setSessions] = useState({}); // role -> { address, token, user }
  const [widget, setWidget] = useState(null);
  const [log, setLog] = useState([]);
  const [checks, setChecks] = useState({});
  const [trade, setTrade] = useState(null);
  const sRef = useRef({});
  sRef.current = sessions;

  const say = (kind, text, extra) =>
    setLog((l) => [{ t: new Date().toLocaleTimeString(), kind, text, extra: extra ? JSON.stringify(extra, null, 2) : '' }, ...l].slice(0, 80));
  const setCheck = (id, pass, detail) => setChecks((c) => ({ ...c, [id]: { pass, detail } }));
  const patch = (role, v) => setSessions((s) => ({ ...s, [role]: { ...s[role], ...v } }));

  function localAccount(role) {
    if (!keys.current[role]) {
      keys.current[role] = generatePrivateKey();
      sessionStorage.setItem('np-test-keys', JSON.stringify(keys.current));
    }
    return privateKeyToAccount(keys.current[role]);
  }

  // The simulator keeps one identity per browser window. To get a second person, verify the requester in an
  // Incognito window, copy its (throwaway test) key here, and import it in the main window.
  async function copyKey(role) {
    const acct = localAccount(role);
    await navigator.clipboard.writeText(keys.current[role]);
    say('ok', `${role} test key copied (wallet ${short(acct.address.toLowerCase())}). Paste it with "Import key" in the other window.`);
  }
  function importKey(role) {
    const v = (window.prompt(`Paste the ${role} test key (0x…)`) ?? '').trim();
    if (!/^0x[0-9a-fA-F]{64}$/.test(v)) return say('error', 'That is not a 32-byte 0x key');
    keys.current[role] = v;
    sessionStorage.setItem('np-test-keys', JSON.stringify(keys.current));
    setSessions((x) => ({ ...x, [role]: undefined }));
    say('ok', `${role} key imported (wallet ${short(privateKeyToAccount(v).address.toLowerCase())}). Press Sign in to continue.`);
  }

  async function signIn(role) {
    let address, sign;
    if (role === 'admin') {
      if (!window.ethereum) return say('error', 'MetaMask not found');
      const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
      address = a.toLowerCase();
      if (address !== ADMIN) return say('error', `Admin must be ${ADMIN}. MetaMask is on ${address}. Switch account, or start the backend with ADMIN_ADDRESSES=${address} and open this page with ?admin=${address}`);
      sign = (message) => window.ethereum.request({ method: 'personal_sign', params: [message, address] });
    } else {
      const acct = localAccount(role);
      address = acct.address.toLowerCase();
      sign = (message) => acct.signMessage({ message });
    }
    const n = await api('/auth/nonce', { body: { address } });
    if (!n.ok) return say('error', `${role}: nonce failed`, n.json);
    const v = await api('/auth/verify', { body: { address, signature: await sign(n.json.message) } });
    if (!v.ok) return say('error', `${role}: sign-in failed — ${v.json.error}`, v.json);
    patch(role, { address, token: v.json.token, user: v.json.user });
    say('ok', `${role} signed in as ${short(address)}`);
  }

  async function startWorld(role) {
    const s = sRef.current[role];
    if (!s?.token) return say('error', `Sign in the ${role} first`);
    const r = await api('/world-id/request', { token: s.token, body: {} });
    if (!r.ok) return say('error', 'could not start World ID', r.json);
    say('info', `World ID for ${role}: approve in the simulator with ${ROLES.find((x) => x.id === role).human}.`);
    setWidget({
      role,
      config: { app_id: r.json.app_id, action: r.json.action, rp_context: r.json.rp_context, environment: r.json.environment, allow_legacy_proofs: false, preset: proofOfHuman({ signal: r.json.signal }) },
    });
  }

  async function handleVerify(result) {
    const role = widget.role;
    const s = sRef.current[role];
    const r = await api('/world-id/verify', { token: s.token, body: result });
    if (role === 'evader') {
      const refused = r.json.error === 'human_banned';
      setCheck('evader', refused, refused ? 'Refused with human_banned on a brand-new wallet' : `Unexpected: ${r.ok ? 'ACCEPTED' : r.json.error}`);
      say(refused ? 'ok' : 'error', refused ? 'EVADER REFUSED: this person is banned, a new wallet does not help' : `evader result unexpected: ${r.json.error ?? 'accepted'}`, r.json.details);
      throw new Error(refused ? 'Banned (expected)' : 'Unexpected result');
    }
    if (!r.ok) {
      say('error', `${role} refused: ${r.json.error} — ${r.json.message ?? ''}`, r.json.details);
      throw new Error(r.json.message ?? 'refused');
    }
    patch(role, { user: r.json.user });
    say('ok', `${role} VERIFIED (nullifier …${String(r.json.user.worldIdNullifier).slice(-6)})`);
  }

  // R creates and "funds" a request, F accepts and hands over a code, R disputes. (Escrow runs in mock mode: no USDC moves.)
  async function runTradeToDispute() {
    const S = sRef.current;
    for (const role of ['requester', 'fulfiller']) {
      if (!S[role]?.user?.worldIdNullifier) return say('error', `${role} must be signed in and World-ID verified first`);
    }
    const R = S.requester.token, F = S.fulfiller.token;
    let id;
    const r = await api('/requests', { token: R, body: { brand: 'amazon', amountInr: 1000, amountUsdc: '11.25' } });
    if (!r.ok) return say('error', `create request failed: ${r.json.error} — ${r.json.message}`, r.json.details);
    id = r.json.request.id;
    say('ok', 'requester creates the request');
    const run = async (name, fn) => { const x = await fn(); if (!x.ok) { say('error', `${name} failed: ${x.json.error} — ${x.json.message}`); return false; } say('ok', name); return true; };
    if (!(await run('requester funds the escrow (mock)', () => api(`/requests/${id}/fund`, { token: R, body: { txHash: fakeTx() } })))) return;
    if (!(await run('fulfiller accepts', () => api(`/requests/${id}/accept`, { token: F, body: {} })))) return;
    if (!(await run('fulfiller hands over a USED voucher code', () => api(`/requests/${id}/submit-code`, { token: F, body: { code: 'ALREADY-USED-0001', pin: '0000' } })))) return;
    if (!(await run('requester disputes: "voucher already redeemed"', () => api(`/requests/${id}/dispute`, { token: R, body: { reason: 'Voucher was already redeemed' } })))) return;
    setTrade({ id });
    say('ok', `Request ${id} is now DISPUTED. Next: admin rules on it.`);
  }

  async function resolve(outcome) {
    const A = sRef.current.admin;
    if (!A?.token) return say('error', 'Sign in the admin first (MetaMask on the admin account)');
    if (!trade) return say('error', 'Run the trade to a dispute first');
    const r = await api(`/requests/${trade.id}/resolve`, { token: A.token, body: { outcome, note: 'Used voucher confirmed by the arbitrator' } });
    if (!r.ok) return say('error', `resolve failed: ${r.json.error} — ${r.json.message}`);
    const q = r.json.request;
    say('ok', `Ruled: ${outcome}. Status ${q.status}. Fault: ${q.resolution?.fault}. Banned party: ${q.bannedParty ?? 'nobody'}`, { status: q.status, resolution: q.resolution, bannedParty: q.bannedParty });
    setCheck('fault', q.resolution?.fault === 'fulfiller' && q.bannedParty === 'fulfiller', `fault=${q.resolution?.fault}, bannedParty=${q.bannedParty}, status=${q.status}`);
    await checkAfter();
  }

  async function checkAfter() {
    const S = sRef.current;
    const f = await api('/auth/me', { token: S.fulfiller.token });
    setCheck('locked', f.status === 403 && f.json.error === 'banned', `fulfiller's old wallet: HTTP ${f.status} ${f.json.error ?? ''}`);
    const q = await api('/auth/me', { token: S.requester.token });
    setCheck('honest', q.ok, `requester still fine: HTTP ${q.status}`);
  }

  const box = { border: '1px solid #c9c6bb', borderRadius: 10, padding: 16, margin: '14px 0', background: '#fff' };
  const btn = { padding: '8px 14px', borderRadius: 999, border: 0, background: '#1c1c1a', color: '#fff', cursor: 'pointer', marginRight: 8 };
  const badge = (ok) => (ok === undefined ? '○' : ok ? '✓' : '✗');

  return (
    <div style={{ font: '15px system-ui, sans-serif', maxWidth: 820, margin: '24px auto', padding: '0 16px', color: '#1c1c1a' }}>
      <h2>Dispute → human ban test</h2>
      <p style={{ color: '#5b5b55' }}>
        Real World ID (staging simulator), mock escrow. Admin address expected: <code>{ADMIN}</code>. Needs two simulator identities:
        <b> A</b> (fulfiller and evader) and <b>B</b> (requester).
      </p>

      <div style={box}>
        <b>1 · Wallets and humans</b>
        {ROLES.map((r) => {
          const s = sessions[r.id];
          return (
            <div key={r.id} style={{ margin: '10px 0', padding: 8, background: '#faf8f3', borderRadius: 8 }}>
              <div><b>{r.label}</b> · human: {r.human}</div>
              <div style={{ fontSize: 13, color: '#5b5b55' }}>
                {s?.address ? `wallet ${short(s.address)} · signed in` : 'not signed in'}
                {r.id !== 'admin' && s?.user ? (s.user.worldIdNullifier ? ' · World ID ✓' : ' · World ID not yet') : ''}
              </div>
              <button style={btn} onClick={() => signIn(r.id)}>Sign in</button>
              {r.id !== 'admin' && <button style={btn} onClick={() => startWorld(r.id)}>Verify with World ID</button>}
              {r.id !== 'admin' && <button style={{ ...btn, background: '#5b5b55' }} onClick={() => copyKey(r.id)}>Copy key</button>}
              {r.id !== 'admin' && <button style={{ ...btn, background: '#5b5b55' }} onClick={() => importKey(r.id)}>Import key</button>}
            </div>
          );
        })}
        <p style={{ fontSize: 13, color: '#5b5b55' }}>
          <b>Two people are needed, and the simulator gives one identity per browser window.</b><br />
          Main window: sign in + verify the <b>fulfiller</b> (identity A). Sign in the <b>admin</b> with MetaMask.<br />
          Incognito window (open this same page there): sign in + verify the <b>requester</b> (this window's simulator is identity B), then press <b>Copy key</b>.<br />
          Back in the main window: press <b>Import key</b> on the requester, paste, then <b>Sign in</b>. It should show World ID ✓.
          Leave the evader for step 3.
        </p>
      </div>

      <div style={box}>
        <b>2 · Trade, dispute, ruling</b>
        <div style={{ margin: '8px 0' }}>
          <button style={btn} onClick={runTradeToDispute}>Run trade up to the dispute</button>
          <button style={btn} onClick={() => resolve('refund')}>Admin rules: voucher was used (refund the requester)</button>
        </div>
        <div style={{ fontSize: 13, color: '#5b5b55' }}>{trade ? `Request ${trade.id} is disputed.` : 'No trade yet.'}</div>
      </div>

      <div style={box}>
        <b>3 · Does the ban hold?</b>
        <p style={{ margin: '6px 0', fontSize: 13, color: '#5b5b55' }}>
          After the ruling, sign in the <b>evader</b> (a brand-new wallet) and try to verify it with simulator identity <b>A</b> again. It must be refused.
        </p>
        <button style={btn} onClick={() => startWorld('evader')}>Evader: verify with identity A</button>
        <div style={{ marginTop: 10 }}>
          {[
            ['fault', 'Ruling bans the fulfiller (the person who sold the used voucher)'],
            ['locked', "Fulfiller's wallet is locked out"],
            ['honest', 'Requester (honest) is not affected'],
            ['evader', 'Same person on a brand-new wallet is refused (human_banned)'],
          ].map(([id, label]) => (
            <div key={id} style={{ margin: '4px 0', color: checks[id] ? (checks[id].pass ? '#2f7a4d' : '#b3382c') : '#5b5b55' }}>
              {badge(checks[id]?.pass)} {label} {checks[id] && <small>— {checks[id].detail}</small>}
            </div>
          ))}
        </div>
      </div>

      <div style={box}>
        <b>Log</b>
        {log.map((l, i) => (
          <div key={i} style={{ margin: '6px 0', color: l.kind === 'error' ? '#b3382c' : l.kind === 'ok' ? '#2f7a4d' : '#1c1c1a' }}>
            <small>{l.t}</small> {l.text}
            {l.extra && <pre style={{ margin: '4px 0', fontSize: 12, whiteSpace: 'pre-wrap', background: '#faf8f3', padding: 6, borderRadius: 6 }}>{l.extra}</pre>}
          </div>
        ))}
      </div>

      {widget && (
        <IDKitRequestWidget
          {...widget.config}
          open
          onOpenChange={(o) => { if (!o) setWidget(null); }}
          handleVerify={handleVerify}
          onSuccess={() => setWidget(null)}
          onError={(code) => { say('error', `Widget: ${code}`); setWidget(null); }}
        />
      )}
    </div>
  );
}
