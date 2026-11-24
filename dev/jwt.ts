// Minimal HS256 JWT helpers for the local stack only (PostgREST verifies them with the same secret).
import { createHmac, timingSafeEqual } from 'node:crypto';

export const DEV_JWT_SECRET = 'sparkle-local-dev-secret-not-for-production-0123456789';

const b64url = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export function signHs256(payload: Record<string, unknown>, secret = DEV_JWT_SECRET): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export function verifyHs256(token: string, secret = DEV_JWT_SECRET): Record<string, unknown> | null {
  const [header, body, signature] = token.split('.');
  if (!header || !body || !signature) return null;
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest();
  const given = Buffer.from(signature, 'base64url');
  if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as Record<string, unknown>;
  if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
  return payload;
}
