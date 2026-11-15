import { Router } from 'express';
import { escrowTerms, readEscrow, chainNow, isMock } from '../services/escrow.js';
import { HttpError } from '../lib/errors.js';
import { config } from '../config.js';

const router = Router();

/**
 * GET /escrow/terms → what the escrow contract will charge and allow right now, read from the contract:
 * fee, order limits, the launch cap and how much of it is in use, the dispute stake, the time windows and whether new
 * deposits are paused. The app shows these before any wallet prompt. Amounts are 6-decimal USDC base units as strings.
 */
router.get('/terms', async (_req, res) => {
  res.set('cache-control', 'public, max-age=15');
  res.json(await escrowTerms());
});

/**
 * GET /escrow/state/:escrowId → the escrow record as this server reads it from the contract, with the chain's clock.
 * A fallback for browsers that cannot reach an Arc node themselves (blocked or rate-limited). It is the server's
 * word, not an independent check: the app says so when it uses it. 404 in mock mode.
 */
router.get('/state/:escrowId', async (req, res) => {
  if (isMock) throw new HttpError(404, 'not_found', 'No contract in mock mode');
  if (!/^0x[0-9a-fA-F]{64}$/.test(req.params.escrowId)) throw new HttpError(400, 'bad_escrow_id', 'Escrow id must be a 32-byte hash');
  const [e, now] = await Promise.all([readEscrow(req.params.escrowId), chainNow()]);
  res.set('cache-control', 'no-store');
  res.json({ escrow: { ...e, amount: e.amount.toString(), fee: e.fee.toString(), bond: e.bond.toString() }, chainTime: now, source: 'server' });
});

/**
 * POST /escrow/rpc → a read-only relay to the Arc node for browsers and wallets that cannot reach one themselves.
 * Only the calls the app needs to prepare and follow a transaction, and eth_call / eth_estimateGas only towards the
 * escrow contract and USDC. It never signs or sends anything. Accepts one JSON-RPC request or a batch of up to 10.
 */
const RELAY_METHODS = new Set(['eth_chainId', 'eth_blockNumber', 'eth_getBlockByNumber', 'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory', 'eth_getTransactionReceipt', 'eth_getTransactionByHash', 'eth_getBalance', 'eth_getTransactionCount', 'eth_call', 'eth_estimateGas']);
function relayAllowed(call) {
  if (!call || typeof call.method !== 'string' || !RELAY_METHODS.has(call.method) || !Array.isArray(call.params)) return false;
  if (call.method === 'eth_call' || call.method === 'eth_estimateGas') {
    const to = String(call.params[0]?.to ?? '').toLowerCase();
    return to === config.ESCROW_CONTRACT_ADDRESS.toLowerCase() || to === config.USDC_ADDRESS.toLowerCase();
  }
  return true;
}
router.post('/rpc', async (req, res) => {
  if (isMock) throw new HttpError(404, 'not_found', 'No chain in mock mode');
  const batch = Array.isArray(req.body);
  const calls = batch ? req.body : [req.body];
  if (!calls.length || calls.length > 10) throw new HttpError(400, 'bad_rpc', 'Send one request or a batch of up to 10');
  const out = await Promise.all(calls.map(async (call) => {
    const id = call?.id ?? null;
    if (!relayAllowed(call)) return { jsonrpc: '2.0', id, error: { code: -32601, message: 'This relay only serves read calls for the escrow and USDC' } };
    try {
      const r = await fetch(config.ARC_RPC_URL, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id, method: call.method, params: call.params }), signal: AbortSignal.timeout(15_000) });
      const j = await r.json();
      return j.error ? { jsonrpc: '2.0', id, error: j.error } : { jsonrpc: '2.0', id, result: j.result };
    } catch (err) {
      return { jsonrpc: '2.0', id, error: { code: -32000, message: `Arc node did not answer: ${err.message}` } };
    }
  }));
  res.set('cache-control', 'no-store');
  res.json(batch ? out : out[0]);
});

export default router;
