import { config } from '../config.js';
import { db, FieldValue } from './firestore.js';

/**
 * Platform settings an administrator can change while the server runs. Stored in Firestore (settings/platform), with
 * every change appended to settings/platform/history.
 *
 *   worldIdRequired  true: creating, funding, accepting and delivering need a World ID bound to the wallet
 *                    (one person, one account). false: any signed-in wallet can trade.
 *
 * Until an administrator sets it, the value is WORLD_ID_REQUIRED from the environment (default true).
 */
const ref = () => db.collection('settings').doc('platform');
const TTL_MS = 15_000;
let cache = null;

const defaults = () => ({ worldIdRequired: config.WORLD_ID_REQUIRED });

export async function getSettings({ fresh = false } = {}) {
  if (!fresh && cache && cache.at > Date.now() - TTL_MS) return cache.value;
  const snap = await ref().get();
  const stored = snap.exists ? snap.data() : {};
  const value = {
    worldIdRequired: typeof stored.worldIdRequired === 'boolean' ? stored.worldIdRequired : defaults().worldIdRequired,
    updatedBy: stored.updatedBy ?? null,
    updatedAt: stored.updatedAt?.toDate ? stored.updatedAt.toDate().toISOString() : null,
  };
  cache = { at: Date.now(), value };
  return value;
}

export async function updateSettings(admin, changes) {
  const before = await getSettings({ fresh: true });
  const update = {};
  if (typeof changes.worldIdRequired === 'boolean') update.worldIdRequired = changes.worldIdRequired;
  if (!Object.keys(update).length) return before;
  const batch = db.batch();
  batch.set(ref(), { ...update, updatedBy: admin, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
  batch.create(ref().collection('history').doc(), { by: admin, at: FieldValue.serverTimestamp(), from: { worldIdRequired: before.worldIdRequired }, to: update });
  await batch.commit();
  cache = null;
  return getSettings({ fresh: true });
}

/** Tests only. */
export const clearSettingsCache = () => { cache = null; };
