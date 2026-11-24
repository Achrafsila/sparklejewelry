import pg from 'pg';
import { randomUUID } from 'node:crypto';

export const ADMIN_ID = '00000000-0000-4000-8000-000000000001';
export const OTHER_USER_ID = '00000000-0000-4000-8000-000000000002';
export const PG_URL = process.env.SPARKLE_PG_URL ?? 'postgres://postgres@localhost:54329';
export const TEMPLATE_DB = 'sparkle_template';

export type Session = 'admin' | 'user' | 'anon' | 'service';

export interface TestDb {
  name: string;
  pool: pg.Pool;
  connect(session: Session): Promise<pg.PoolClient>;
  asAdmin(): Promise<pg.PoolClient>;
  asAnon(): Promise<pg.PoolClient>;
  drop(): Promise<void>;
}

const claimsFor: Record<Session, object | null> = {
  admin: { sub: ADMIN_ID, role: 'authenticated' },
  user: { sub: OTHER_USER_ID, role: 'authenticated' },
  anon: { role: 'anon' },
  service: { role: 'service_role' },
};
const roleFor: Record<Session, string> = {
  admin: 'authenticated',
  user: 'authenticated',
  anon: 'anon',
  service: 'service_role',
};

/** Clones the migrated template database so each test file runs in isolation. */
export async function freshDb(): Promise<TestDb> {
  const name = `t_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
  const root = new pg.Client({ connectionString: `${PG_URL}/postgres` });
  await root.connect();
  await root.query(`create database ${name} template ${TEMPLATE_DB}`);
  await root.end();

  const pool = new pg.Pool({ connectionString: `${PG_URL}/${name}`, max: 8 });

  async function connect(session: Session) {
    const client = await pool.connect();
    await client.query('reset role');
    await client.query(`select set_config('request.jwt.claims', $1, false)`, [
      JSON.stringify(claimsFor[session]),
    ]);
    await client.query(`set role ${roleFor[session]}`);
    return client;
  }

  return {
    name,
    pool,
    connect,
    asAdmin: () => connect('admin'),
    asAnon: () => connect('anon'),
    async drop() {
      await pool.end();
      const c = new pg.Client({ connectionString: `${PG_URL}/postgres` });
      await c.connect();
      await c.query(`drop database if exists ${name} with (force)`);
      await c.end();
    },
  };
}

/** Calls a SQL function with named arguments; objects and arrays are sent as JSON. */
export async function rpc<T = any>(
  client: pg.PoolClient | pg.Pool,
  fn: string,
  args: Record<string, unknown> = {},
): Promise<T> {
  const keys = Object.keys(args);
  const values = keys.map((k) => {
    const v = args[k];
    return v !== null && typeof v === 'object' && !(v instanceof Date) ? JSON.stringify(v) : v;
  });
  const params = keys.map((k, i) => `${k} => $${i + 1}`).join(', ');
  const { rows } = await client.query(`select ${fn}(${params}) as r`, values);
  return rows[0].r as T;
}

export interface BusinessError {
  message: string;
  detail: any;
}

/** Expects a business error raised with `raise exception using message = code`. */
export async function expectError(promise: Promise<unknown>, code: string): Promise<BusinessError> {
  try {
    await promise;
  } catch (e: any) {
    if (e?.message !== code) throw new Error(`Expected ${code}, got: ${e?.message}`);
    let detail: any = e.detail;
    try {
      detail = e.detail ? JSON.parse(e.detail) : null;
    } catch {
      /* keep raw detail */
    }
    return { message: e.message, detail };
  }
  throw new Error(`Expected error ${code}, but the call succeeded`);
}

/** Every variant's quantities must equal the sum of its stock movements. */
export async function assertLedger(pool: pg.Pool): Promise<void> {
  const { rows } = await pool.query(`
    select v.sku, v.physical_qty, v.reserved_qty,
           coalesce(sum(m.physical_delta), 0)::int as phys_sum,
           coalesce(sum(m.reserved_delta), 0)::int as res_sum
    from variants v left join stock_movements m on m.variant_id = v.id
    group by v.id`);
  for (const r of rows) {
    if (r.physical_qty !== r.phys_sum || r.reserved_qty !== r.res_sum) {
      throw new Error(
        `Ledger mismatch for ${r.sku}: physical ${r.physical_qty} vs ${r.phys_sum}, reserved ${r.reserved_qty} vs ${r.res_sum}`,
      );
    }
  }
}
