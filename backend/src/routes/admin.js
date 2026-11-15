import { Router } from 'express';
import { z } from 'zod';
import { formatUnits } from 'viem';
import { config } from '../config.js';
import { requireAuth, requireAdmin } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { getSettings, updateSettings } from '../services/settings.js';
import { escrowTerms, keeperAddress, arbiterConfigured, publicClient, isMock } from '../services/escrow.js';
import { worldIdReady, worldIdProblem } from '../services/worldid.js';
import { col, serialize } from '../services/firestore.js';
import { S } from '../services/requests.js';
import { HttpError } from '../lib/errors.js';

const router = Router();

/** GET /admin/me → { admin } for the signed-in wallet. Lets the app decide whether to show the admin screen. */
router.get('/me', requireAuth, (req, res) => {
  res.json({ admin: config.ADMIN_ADDRESSES.includes(req.user.address) });
});

router.use(requireAuth, requireAdmin);

async function countByStatus() {
  const out = {};
  await Promise.all(Object.values(S).map(async (status) => {
    const q = col.requests.where('status', '==', status);
    try {
      out[status] = (await q.count().get()).data().count;
    } catch {
      out[status] = (await q.limit(1000).get()).size; // stores without count()
    }
  }));
  return out;
}

/** GET /admin/overview → settings, the contract's terms, order counts, open disputes and the health of each part. */
router.get('/overview', async (_req, res) => {
  const [settings, terms, orders, disputes] = await Promise.all([
    getSettings({ fresh: true }),
    escrowTerms(),
    countByStatus(),
    col.requests.where('status', '==', S.DISPUTED).limit(50).get(),
  ]);
  let keeper = null;
  if (!isMock && keeperAddress) {
    const wei = await publicClient.getBalance({ address: keeperAddress }).catch(() => null);
    // Arc pays gas in USDC, counted with 18 decimals as the native coin.
    keeper = { address: keeperAddress, gasUsdc: wei === null ? null : Number(formatUnits(wei, 18)).toFixed(4), low: wei !== null && wei < 200_000_000_000_000_000n };
  }
  res.json({
    settings,
    terms,
    orders,
    disputes: disputes.docs.map((d) => serialize({ id: d.id, brand: d.data().brand, amountUsdc: d.data().amountUsdc, crypto_spender: d.data().crypto_spender, crypto_buyer: d.data().crypto_buyer, category: d.data().dispute?.category ?? null, disputedAt: d.data().disputedAt ?? null })),
    keeper,
    arbiterKeyOnServer: arbiterConfigured,
    worldId: { ready: worldIdReady(), problem: worldIdProblem(), environment: config.WORLD_ID_ENV, mock: config.WORLD_ID_MOCK, bypass: config.WORLD_ID_DEV_BYPASS },
    server: { env: config.NODE_ENV, escrowMode: config.ESCROW_MODE, chainId: config.ARC_CHAIN_ID, voucherMode: config.VOUCHER_MODE, admins: config.ADMIN_ADDRESSES, rateCheckPct: config.RATE_MAX_DEVIATION_PCT },
  });
});

/** PUT /admin/settings { worldIdRequired } → turn the World ID requirement on or off. Recorded with who and when. */
router.put('/settings', validate(z.object({ worldIdRequired: z.boolean() }).strict()), async (req, res) => {
  // Switching it on while World ID cannot run would lock every new user out.
  if (req.body.worldIdRequired && !config.WORLD_ID_MOCK && !config.WORLD_ID_DEV_BYPASS && !worldIdReady()) {
    throw new HttpError(409, 'world_id_not_ready', `World ID cannot be switched on yet: ${worldIdProblem() || 'the RP id or signing key is not set on the server'}`);
  }
  res.json({ settings: await updateSettings(req.user.address, req.body) });
});

export default router;
