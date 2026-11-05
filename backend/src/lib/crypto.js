import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { config } from '../config.js';

const KEY = Buffer.from(config.VOUCHER_ENC_KEY, 'hex');

/**
 * AES-256-GCM. `aad` binds the ciphertext to a context (the request id) so an
 * encrypted code cannot be copied onto a different request and still decrypt.
 */
export function encrypt(plaintext, aad) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', KEY, iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return { iv: iv.toString('base64'), ct: ct.toString('base64'), tag: tag.toString('base64') };
}

export function decrypt(box, aad) {
  const decipher = createDecipheriv('aes-256-gcm', KEY, Buffer.from(box.iv, 'base64'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(box.tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(box.ct, 'base64')), decipher.final()]).toString('utf8');
}
