import crypto from 'node:crypto';
import { serverConfig } from './config';

/**
 * Signed, time-limited OAuth state token.
 *
 * Why: passing the raw `user.id` as `state` is predictable (CSRF risk)
 * AND it forces the callback handler to re-verify the Supabase session
 * to know which user this is for. Sessions can be flaky across the
 * Google OAuth round-trip — so we instead sign the user id with HMAC
 * and verify in the callback without touching the session.
 *
 * Format (base64url-encoded):  userId.timestamp.signature
 * Signature: HMAC-SHA256 over `${userId}.${timestamp}` using ENCRYPTION_KEY_BASE64.
 *
 * Tokens expire in 10 minutes — plenty for any honest OAuth flow.
 */

const MAX_AGE_MS = 10 * 60 * 1000;

function key(): Buffer {
  return Buffer.from(serverConfig().ENCRYPTION_KEY_BASE64, 'base64');
}

export function signOAuthState(userId: string): string {
  const ts = Date.now().toString();
  const payload = `${userId}.${ts}`;
  const sig = crypto.createHmac('sha256', key()).update(payload).digest('hex');
  return Buffer.from(`${payload}.${sig}`, 'utf8').toString('base64url');
}

export function verifyOAuthState(state: string): { userId: string } | null {
  try {
    const decoded = Buffer.from(state, 'base64url').toString('utf8');
    const parts = decoded.split('.');
    if (parts.length !== 3) return null;
    const [userId, ts, sig] = parts;
    if (!userId || !ts || !sig) return null;

    // Verify HMAC
    const expected = crypto
      .createHmac('sha256', key())
      .update(`${userId}.${ts}`)
      .digest('hex');
    const a = Buffer.from(sig, 'hex');
    const b = Buffer.from(expected, 'hex');
    if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

    // Check expiry
    const tsNum = Number(ts);
    if (!Number.isFinite(tsNum)) return null;
    if (Date.now() - tsNum > MAX_AGE_MS) return null;

    return { userId };
  } catch {
    return null;
  }
}
