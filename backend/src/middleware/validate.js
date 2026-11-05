import { z } from 'zod';
import { badRequest } from '../lib/errors.js';

/** Validate req.body (or req.query) against a zod schema; replaces it with the parsed value. */
export const validate = (schema, source = 'body') => (req, _res, next) => {
  const result = schema.safeParse(req[source] ?? {});
  if (!result.success) {
    throw badRequest('validation_error', 'Invalid input', result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })));
  }
  if (source === 'query') req.validQuery = result.data; // req.query is read-only in Express 5
  else req[source] = result.data;
  next();
};

export const address = z
  .string()
  .regex(/^0x[0-9a-fA-F]{40}$/, 'Must be a 0x-prefixed 20-byte address')
  .transform((a) => a.toLowerCase());

export const txHash = z.string().regex(/^0x[0-9a-fA-F]{64}$/, 'Must be a 0x-prefixed 32-byte hash');
export const hex = z.string().regex(/^0x[0-9a-fA-F]+$/, 'Must be 0x-prefixed hex');
