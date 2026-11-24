// Development-only stand-in for Supabase Auth and Storage, mounted in the Vite dev server
// when running `vite --mode local-stack`. PostgREST (the real one) is proxied under /rest/v1.
// Never part of `vite build`: vite.config.ts only imports this file for the dev server.
import { randomUUID } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, existsSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, extname, join, normalize } from 'node:path';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Plugin } from 'vite';
import { signHs256, verifyHs256 } from './jwt';

const root = join(import.meta.dirname, '..');
// Same folder as dev/stack.sh (outside the project, which may be cloud-synced).
const localDir = process.env.SPARKLE_LOCAL_DIR ?? join(homedir(), 'Library', 'Application Support', 'sparkle-backoffice');
const storageRoot = join(localDir, 'storage');
const SESSION_SECONDS = 3600;

interface DevUser {
  id: string;
  email: string;
  password: string;
}

function users(): DevUser[] {
  return (JSON.parse(readFileSync(join(root, 'dev', 'users.json'), 'utf8')) as { users: DevUser[] }).users;
}

const refreshTokens = new Map<string, string>();

function userJson(u: DevUser) {
  return {
    id: u.id,
    aud: 'authenticated',
    role: 'authenticated',
    email: u.email,
    email_confirmed_at: '2026-01-01T00:00:00Z',
    app_metadata: { provider: 'email', providers: ['email'] },
    user_metadata: {},
    identities: [],
    created_at: '2026-01-01T00:00:00Z',
    updated_at: '2026-01-01T00:00:00Z',
  };
}

function session(u: DevUser) {
  const now = Math.floor(Date.now() / 1000);
  const refresh = randomUUID();
  refreshTokens.set(refresh, u.id);
  return {
    access_token: signHs256({
      sub: u.id,
      role: 'authenticated',
      aud: 'authenticated',
      email: u.email,
      iat: now,
      exp: now + SESSION_SECONDS,
      session_id: randomUUID(),
    }),
    token_type: 'bearer',
    expires_in: SESSION_SECONDS,
    expires_at: now + SESSION_SECONDS,
    refresh_token: refresh,
    user: userJson(u),
  };
}

function send(res: ServerResponse, status: number, body?: unknown) {
  res.statusCode = status;
  if (body === undefined) return res.end();
  res.setHeader('content-type', 'application/json');
  res.end(JSON.stringify(body));
}

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function bearer(req: IncomingMessage) {
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  return token ? verifyHs256(token) : null;
}

const contentTypes: Record<string, string> = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function safePath(objectPath: string) {
  const target = normalize(join(storageRoot, decodeURIComponent(objectPath)));
  return target.startsWith(storageRoot) ? target : null;
}

async function stub(req: IncomingMessage, res: ServerResponse, next: () => void) {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const path = url.pathname;
        try {
          // ---- Auth ----
          if (path === '/auth/v1/token' && req.method === 'POST') {
            const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
            const grant = url.searchParams.get('grant_type');
            if (grant === 'password') {
              const u = users().find((x) => x.email === String(body.email).trim().toLowerCase() && x.password === body.password);
              if (!u) return send(res, 400, { code: 400, error_code: 'invalid_credentials', msg: 'Invalid login credentials' });
              return send(res, 200, session(u));
            }
            if (grant === 'refresh_token') {
              const id = refreshTokens.get(body.refresh_token);
              const u = users().find((x) => x.id === id);
              if (!u) return send(res, 400, { code: 400, error_code: 'refresh_token_not_found', msg: 'Invalid Refresh Token' });
              refreshTokens.delete(body.refresh_token);
              return send(res, 200, session(u));
            }
            return send(res, 400, { msg: 'unsupported grant_type' });
          }
          if (path === '/auth/v1/user' && req.method === 'GET') {
            const claims = bearer(req);
            const u = users().find((x) => x.id === claims?.sub);
            return u ? send(res, 200, userJson(u)) : send(res, 401, { msg: 'invalid JWT' });
          }
          if (path === '/auth/v1/user' && req.method === 'PUT') {
            // Password change after a reset link: accepted, not persisted (local test account).
            const claims = bearer(req);
            const u = users().find((x) => x.id === claims?.sub);
            await readBody(req);
            return u ? send(res, 200, userJson(u)) : send(res, 401, { msg: 'invalid JWT' });
          }
          if (path === '/auth/v1/logout') return send(res, 204);
          if (path === '/auth/v1/recover') return send(res, 200, {});

          // ---- Storage ----
          const upload = /^\/storage\/v1\/object\/(photos\/.+)$/.exec(path);
          if (upload && (req.method === 'POST' || req.method === 'PUT') && !path.includes('/public/')) {
            const claims = bearer(req);
            if (claims?.role !== 'authenticated') return send(res, 403, { message: 'Unauthorized' });
            const target = safePath(upload[1]!);
            if (!target) return send(res, 400, { message: 'Invalid path' });
            const body = await readBody(req);
            if (body.length === 0) return send(res, 400, { message: 'Empty file' });
            mkdirSync(dirname(target), { recursive: true });
            writeFileSync(target, body);
            return send(res, 200, { Key: upload[1], Id: randomUUID() });
          }
          const pub = /^\/storage\/v1\/object\/public\/(photos\/.+)$/.exec(path);
          if (pub && req.method === 'GET') {
            const target = safePath(pub[1]!);
            if (!target || !existsSync(target)) return send(res, 404, { message: 'Object not found' });
            res.setHeader('content-type', contentTypes[extname(target).toLowerCase()] ?? 'application/octet-stream');
            res.setHeader('cache-control', 'public, max-age=3600');
            return res.end(readFileSync(target));
          }
        } catch (e) {
          return send(res, 500, { message: (e as Error).message });
        }
        next();
}

/** Mounted on the dev server and on `vite preview` (used by the E2E tests on the built app). */
export function supabaseStub(): Plugin {
  return {
    name: 'sparkle-supabase-stub',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((req, res, next) => void stub(req, res, next));
    },
    configurePreviewServer(server) {
      server.middlewares.use((req, res, next) => void stub(req, res, next));
    },
  };
}
