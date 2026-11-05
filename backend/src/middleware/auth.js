import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { col } from '../services/firestore.js';
import { unauthorized, forbidden } from '../lib/errors.js';

export function issueToken(address) {
  return jwt.sign({ sub: address }, config.JWT_SECRET, { expiresIn: config.JWT_TTL, algorithm: 'HS256' });
}

/** Requires `Authorization: Bearer <jwt>` from POST /auth/verify. Loads req.user. */
export async function requireAuth(req, _res, next) {
  const header = req.get('authorization') ?? '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) throw unauthorized();

  let payload;
  try {
    payload = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] });
  } catch {
    throw unauthorized('Invalid or expired token');
  }

  const snap = await col.users.doc(payload.sub).get();
  if (!snap.exists) throw unauthorized('Unknown user');
  const user = snap.data();
  if (user.banned) throw forbidden('banned', 'This account is banned');

  req.user = { address: payload.sub, ...user };
  next();
}

/** Requires a verified World ID bound to this wallet (one human, one account). */
export function requireHuman(req, _res, next) {
  if (!req.user?.worldIdNullifier) throw forbidden('world_id_required', 'Verify with World ID first');
  next();
}

export function requireAdmin(req, _res, next) {
  if (!config.ADMIN_ADDRESSES.includes(req.user?.address)) throw forbidden('admin_only', 'Admin only');
  next();
}
