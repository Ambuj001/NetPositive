import { useEffect, useRef, useState } from 'react';
import { IDKitRequestWidget, proofOfHuman } from '@worldcoin/idkit';

// Test harness for the NetPositive World ID flows: sign-up, wallet recovery, and (see README) bans.
// Everything goes through the backend: /api/* is proxied to http://127.0.0.1:8080.

const T0 = Date.now();
const short = (a) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '—');

async function api(path, { token, body } = {}) {
  const res = await fetch(`/api${path}`, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { 'content-type': 'application/json', ...(token && { authorization: `Bearer ${token}` }) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, json };
}

export default function App() {
  const [address, setAddress] = useState('');
  const [token, setToken] = useState('');
  const [user, setUser] = useState(null);
  const [widget, setWidget] = useState(null); // { mode, config } while the IDKit widget is open
  const [recoveries, setRecoveries] = useState({ asNewWallet: [], asOldWallet: [] });
  const [log, setLog] = useState([]);
  const [firstSuccess, setFirstSuccess] = useState(null);
  const tokenRef = useRef('');
  tokenRef.current = token;

  const say = (kind, text, extra) =>
    setLog((l) => [{ t: new Date().toLocaleTimeString(), kind, text, extra: extra ? JSON.stringify(extra, null, 2) : '' }, ...l].slice(0, 60));

  // Follow MetaMask account changes: a different account is a different session.
  useEffect(() => {
    const eth = window.ethereum;
    if (!eth) return;
    const onAccounts = (accts) => {
      setAddress(accts[0]?.toLowerCase() ?? '');
      setToken('');
      setUser(null);
      setRecoveries({ asNewWallet: [], asOldWallet: [] });
      say('info', `MetaMask account is now ${short(accts[0])}. Sign in again.`);
    };
    eth.on?.('accountsChanged', onAccounts);
    return () => eth.removeListener?.('accountsChanged', onAccounts);
  }, []);

  async function connect() {
    if (!window.ethereum) return say('error', 'No wallet found. Install MetaMask in this browser.');
    const [a] = await window.ethereum.request({ method: 'eth_requestAccounts' });
    setAddress(a.toLowerCase());
    say('ok', `Connected ${a}`);
  }

  async function signIn() {
    const n = await api('/auth/nonce', { body: { address } });
    if (!n.ok) return say('error', 'nonce failed', n.json);
    const signature = await window.ethereum.request({ method: 'personal_sign', params: [n.json.message, address] });
    const v = await api('/auth/verify', { body: { address, signature } });
    if (!v.ok) return say('error', 'sign-in failed', v.json);
    setToken(v.json.token);
    setUser(v.json.user);
    say('ok', `Signed in as ${short(address)}`, { worldIdNullifier: v.json.user.worldIdNullifier ?? null, banned: !!v.json.user.banned });
    refreshRecoveries(v.json.token);
  }

  async function refreshMe() {
    const me = await api('/auth/me', { token });
    if (me.ok) setUser(me.json.user);
    else say('error', 'could not load profile', me.json);
  }

  async function refreshRecoveries(t = token) {
    const r = await api('/recovery/mine', { token: t });
    if (r.ok) setRecoveries(r.json);
  }

  // Ask the server for a signed request, then open the IDKit widget with it.
  async function startWorldId(mode) {
    const r = await api('/world-id/request', { token, body: {} });
    if (!r.ok) return say('error', 'could not start World ID', r.json);
    say('info', `World ID request ready (environment: ${r.json.environment}, action: ${r.json.action}). Approve it in the simulator.`);
    setWidget({
      mode,
      config: {
        app_id: r.json.app_id,
        action: r.json.action,
        rp_context: r.json.rp_context,
        environment: r.json.environment,
        allow_legacy_proofs: false,
        preset: proofOfHuman({ signal: r.json.signal }),
      },
    });
  }

  // Called by the widget with World's result. Throwing here makes the widget show a failure.
  async function handleVerify(result) {
    const mode = widget.mode;
    say('info', `Widget returned a result; sending it to the backend (${mode}).`, {
      keys: Object.keys(result),
      response0Keys: Object.keys(result.responses?.[0] ?? {}),
      environment: result.environment,
      expires_at_min: result.responses?.[0]?.expires_at_min,
      now_unix: Math.floor(Date.now() / 1000),
    });
    const r = mode === 'recover' ? await api('/recovery/start', { token, body: result }) : await api('/world-id/verify', { token, body: result });
    if (!r.ok) {
      say('error', `${mode} refused: ${r.json.error ?? r.status} — ${r.json.message ?? ''}`, r.json.details);
      throw new Error(r.json.message ?? 'Backend refused the proof');
    }
    say('ok', mode === 'recover' ? 'Recovery started (waiting period running)' : 'VERIFIED: World ID accepted and bound to this wallet', mode === 'recover' ? r.json.recovery : { nullifier: r.json.user?.worldIdNullifier });
    setFirstSuccess((t) => t ?? Math.round((Date.now() - T0) / 1000));
  }

  async function onWidgetSuccess() {
    setWidget(null);
    await refreshMe();
    await refreshRecoveries();
  }

  async function recoveryAction(id, what) {
    const r = await api(`/recovery/${id}/${what}`, { token, body: {} });
    if (!r.ok) say('error', `${what} refused: ${r.json.error} — ${r.json.message}`);
    else say('ok', `Recovery ${what}: ${r.json.recovery.status}`, r.json.recovery);
    await refreshMe();
    await refreshRecoveries();
  }

  const verified = !!user?.worldIdNullifier;
  const box = { border: '1px solid #c9c6bb', borderRadius: 10, padding: 16, margin: '14px 0', background: '#fff' };
  const btn = { padding: '10px 16px', borderRadius: 999, border: 0, background: '#1c1c1a', color: '#fff', cursor: 'pointer', marginRight: 8 };
  const off = { ...btn, opacity: 0.4, cursor: 'default' };

  return (
    <div style={{ font: '15px system-ui, sans-serif', maxWidth: 760, margin: '24px auto', padding: '0 16px', color: '#1c1c1a' }}>
      <h2>NetPositive · World ID end-to-end test</h2>
      <p style={{ color: '#5b5b55' }}>
        Staging. Approve requests in the World ID simulator (simulator.worldcoin.org). Time since page load:{' '}
        {firstSuccess != null ? <b>first success after {firstSuccess}s</b> : 'no success yet'}.
      </p>

      <div style={box}>
        <b>1 · Wallet</b>
        <p>Address: <code>{address || 'not connected'}</code> {user && (verified ? '· World ID: ✓ verified' : '· World ID: not verified')}{user?.banned ? ' · BANNED' : ''}</p>
        <button style={btn} onClick={connect}>Connect MetaMask</button>
        <button style={address ? btn : off} disabled={!address} onClick={signIn}>Sign in (signature, no gas)</button>
      </div>

      <div style={box}>
        <b>2 · Sign-up: verify with World ID (Proof of Human)</b>
        <p style={{ color: '#5b5b55', margin: '6px 0' }}>First time for this wallet. One human can link only one wallet.</p>
        <button style={token && !verified ? btn : off} disabled={!token || verified} onClick={() => startWorldId('verify')}>Verify with World ID</button>
      </div>

      <div style={box}>
        <b>3 · Lost wallet: recover from a NEW wallet</b>
        <p style={{ color: '#5b5b55', margin: '6px 0' }}>
          Switch MetaMask to a different account, sign in (step 1), then prove you are the same person as the first wallet.
          After the waiting period, complete the recovery.
        </p>
        <button style={token && !verified ? btn : off} disabled={!token || verified} onClick={() => startWorldId('recover')}>Prove I am the same human (recover)</button>
        <button style={token ? btn : off} disabled={!token} onClick={() => refreshRecoveries()}>Refresh</button>
        {[...recoveries.asNewWallet.map((r) => ({ ...r, as: 'new wallet' })), ...recoveries.asOldWallet.map((r) => ({ ...r, as: 'old wallet' }))].map((r) => (
          <div key={r.id + r.as} style={{ marginTop: 10, padding: 10, background: '#faf8f3', borderRadius: 8 }}>
            <div>
              You are the <b>{r.as}</b> · {short(r.oldAddress)} → {short(r.newAddress)} · status <b>{r.status}</b> · can complete after {new Date(r.executeAfter).toLocaleTimeString()}
            </div>
            {r.as === 'new wallet' && ['pending', 'completing'].includes(r.status) && <button style={btn} onClick={() => recoveryAction(r.id, 'complete')}>Complete recovery</button>}
            {r.as === 'old wallet' && r.status === 'pending' && <button style={btn} onClick={() => recoveryAction(r.id, 'cancel')}>Cancel (this is still my wallet)</button>}
          </div>
        ))}
      </div>

      <div style={box}>
        <b>Log</b>
        {log.length === 0 && <p style={{ color: '#5b5b55' }}>Nothing yet.</p>}
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
          onOpenChange={(o) => { if (!o) { setWidget(null); say('info', 'Widget closed or cancelled.'); } }}
          handleVerify={handleVerify}
          onSuccess={onWidgetSuccess}
          onError={(code) => { say('error', `Widget error: ${code}`); setWidget(null); }}
        />
      )}
    </div>
  );
}
