import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { ADMIN_ID, freshDb, type TestDb } from './helpers';

let db: TestDb;
beforeAll(async () => {
  db = await freshDb();
});
afterAll(async () => {
  await db.drop();
});

describe('local Supabase auth shim', () => {
  test('auth.uid() returns the admin id inside an admin session', async () => {
    const client = await db.asAdmin();
    const { rows } = await client.query('select auth.uid() as id');
    client.release();
    expect(rows[0].id).toBe(ADMIN_ID);
  });

  test('auth.uid() is null for an anonymous session', async () => {
    const client = await db.asAnon();
    const { rows } = await client.query('select auth.uid() as id');
    client.release();
    expect(rows[0].id).toBeNull();
  });
});
