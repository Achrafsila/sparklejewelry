import pg from 'pg';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ADMIN_ID, PG_URL, TEMPLATE_DB } from './helpers';

const root = join(import.meta.dirname, '..', '..');

/** Builds the template database once: auth shim + every migration + test admin. */
export default async function setup() {
  const admin = new pg.Client({ connectionString: `${PG_URL}/postgres` });
  try {
    await admin.connect();
  } catch {
    throw new Error('Local Postgres is not running. Start it with: npm run db:start');
  }
  await admin.query(`drop database if exists ${TEMPLATE_DB} with (force)`);
  await admin.query(`create database ${TEMPLATE_DB}`);
  await admin.end();

  const tpl = new pg.Client({ connectionString: `${PG_URL}/${TEMPLATE_DB}` });
  await tpl.connect();
  await tpl.query(readFileSync(join(root, 'dev', 'auth-shim.sql'), 'utf8'));
  const dir = join(root, 'supabase', 'migrations');
  const files = readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
  for (const file of files) {
    try {
      await tpl.query(readFileSync(join(dir, file), 'utf8'));
    } catch (e: any) {
      throw new Error(`Migration ${file} failed: ${e.message}`);
    }
  }
  await tpl.query(`insert into auth.users (id, email) values ($1, 'admin@sparkle.test') on conflict do nothing`, [
    ADMIN_ID,
  ]);
  await tpl.query(`do $$ begin
    if to_regclass('public.admins') is not null then
      insert into public.admins (user_id) values ('${ADMIN_ID}') on conflict do nothing;
    end if; end $$;`);
  await tpl.end();
}
