import { initializeApp, cert, applicationDefault } from 'firebase-admin/app';
import { getFirestore, FieldValue, Timestamp } from 'firebase-admin/firestore';
import { config } from '../config.js';

function credential() {
  if (config.FIRESTORE_EMULATOR_HOST) return undefined; // emulator needs no credentials
  if (config.FIREBASE_SERVICE_ACCOUNT_JSON) return cert(JSON.parse(config.FIREBASE_SERVICE_ACCOUNT_JSON));
  return applicationDefault(); // GOOGLE_APPLICATION_CREDENTIALS or GCP runtime identity
}

const cred = credential();
const app = initializeApp({ projectId: config.FIREBASE_PROJECT_ID, ...(cred && { credential: cred }) });

export const db = getFirestore(app);
db.settings({ ignoreUndefinedProperties: true });

export { FieldValue, Timestamp };

/**
 * Collections
 *
 * users/{address}                    one doc per wallet (lowercase address)
 * worldIdNullifiers/{nullifierHash}  binds one human to one wallet
 * authNonces/{address}               short-lived sign-in challenge
 * users/{address}/cards/{cardId}    saved card reward profiles (no card numbers), see services/cards.js
 * requests/{requestId}               public lifecycle state (readable by clients)
 * requests/{requestId}/private/voucher  encrypted code + pin (backend-only)
 * requests/{requestId}/events/{auto} audit trail of every transition
 */
export const col = {
  users: db.collection('users'),
  nullifiers: db.collection('worldIdNullifiers'),
  nonces: db.collection('authNonces'),
  requests: db.collection('requests'),
};

export const voucherRef = (requestId) => col.requests.doc(requestId).collection('private').doc('voucher');
export const eventsRef = (requestId) => col.requests.doc(requestId).collection('events');

/** Convert Firestore Timestamps to ISO strings for JSON responses. */
export function serialize(value) {
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (Array.isArray(value)) return value.map(serialize);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, serialize(v)]));
  }
  return value;
}
