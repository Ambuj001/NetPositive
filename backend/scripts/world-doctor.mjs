// Checks this machine's World ID setup step by step and says exactly what is wrong. Prints no secrets.
//   cd backend && npm run world:doctor
// Reads backend/.env the same way the server does. Makes one harmless call to World's verifier with a made-up proof.
process.env.SWEEP_INTERVAL_SECONDS ??= '0';
const { config } = await import('../src/config.js');
const { worldIdProblem, worldIdReady, signWorldIdRequest } = await import('../src/services/worldid.js');

const line = (ok, what, hint) => console.log(`${ok === null ? '  •' : ok ? '  ✓' : '  ✗'} ${what}${hint ? `\n      → ${hint}` : ''}`);
let bad = 0;
const fail = (what, hint) => { bad++; line(false, what, hint); };

console.log('\nWorld ID check\n');
line(null, `environment: ${config.WORLD_ID_ENV}   action: ${config.WORLD_ID_ACTION}   app id: ${config.WORLD_ID_APP_ID}`);
if (config.WORLD_ID_DEV_BYPASS) line(null, 'WORLD_ID_DEV_BYPASS is on: the server skips World ID entirely (local testing only).');
if (config.WORLD_ID_MOCK) line(null, 'WORLD_ID_MOCK is on: proofs are not sent to World.');

if (!config.WORLD_ID_RP_ID) fail('WORLD_ID_RP_ID is empty', 'World Developer Portal → your app → World ID 4.0 → copy the RP ID (starts with rp_).');
else line(true, `RP id is set (${config.WORLD_ID_RP_ID.slice(0, 6)}…)`);
if (!config.WORLD_ID_SIGNING_KEY) fail('WORLD_ID_SIGNING_KEY is empty', 'Same page: create a signing key. It is shown once. Put it in backend/.env only.');
else line(true, 'signing key is set (not shown)');

const problem = worldIdProblem();
if (problem) fail('settings are not usable', problem);

if (worldIdReady()) {
  try {
    const s = signWorldIdRequest();
    line(true, `signed a test request (valid ${s.expires_at - s.created_at}s)`);
  } catch (e) {
    fail('could not sign a request', e.message);
  }
  const url = `${config.WORLD_ID_VERIFY_URL.replace(/\/$/, '').replace(/\/api\/v2\/verify.*/, '/api/v4/verify')}/${config.WORLD_ID_RP_ID}`;
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ protocol_version: '4.0', nonce: '0x0', action: config.WORLD_ID_ACTION, environment: config.WORLD_ID_ENV, responses: [] }),
      signal: AbortSignal.timeout(10_000),
    });
    const body = await res.json().catch(() => null);
    if (res.status === 404) fail(`World does not know this RP id (HTTP 404 from ${new URL(url).host})`, 'Check WORLD_ID_RP_ID, and that World ID 4.0 is enabled for the app.');
    else if (res.status >= 500) fail(`World's verifier answered HTTP ${res.status}`, 'Their side. Try again later.');
    else if (body) line(true, `World's verifier is reachable and answered our made-up proof with HTTP ${res.status}${body.code ? ` (${body.code})` : ''}, as expected`);
    else fail(`World's verifier answered HTTP ${res.status} without JSON`, 'Check WORLD_ID_VERIFY_URL. It should be https://developer.world.org/api/v4/verify');
  } catch (e) {
    fail('could not reach World\'s verifier from this machine', `${e.message}. The server needs outbound HTTPS to developer.world.org.`);
  }
}

if (config.WORLD_ID_ENV !== 'production') {
  line(null, 'Not production: real World App users cannot verify. Test with the simulator at https://simulator.worldcoin.org');
  line(null, 'For real people: set WORLD_ID_ENV=production (and NODE_ENV=production, ESCROW_MODE=chain).');
}
console.log(bad ? `\n${bad} problem${bad > 1 ? 's' : ''} found.\n` : '\nNo problems found on the server side.\n');
process.exit(bad ? 1 : 0);
