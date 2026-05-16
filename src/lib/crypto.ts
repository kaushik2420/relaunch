import crypto from 'node:crypto';
import { serverConfig } from './config';

/**
 * AES-256-GCM helpers for at-rest encryption of Google refresh tokens
 * (and anything else we'd be ashamed to leak). Stored as
 *   base64(iv || ciphertext || authTag)
 * so a single column holds everything needed to decrypt.
 */

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function key(): Buffer {
  const k = Buffer.from(serverConfig().ENCRYPTION_KEY_BASE64, 'base64');
  if (k.length !== 32) {
    throw new Error(
      'ENCRYPTION_KEY_BASE64 must decode to 32 bytes. Regenerate: ' +
        'node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'base64\'))"'
    );
  }
  return k;
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(IV_LEN);
  const cipher = crypto.createCipheriv(ALGO, key(), iv);
  const ct = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ct, tag]).toString('base64');
}

export function decrypt(payload: string): string {
  const buf = Buffer.from(payload, 'base64');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ct = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = crypto.createDecipheriv(ALGO, key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}
