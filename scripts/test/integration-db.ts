/**
 * Integration tests must never touch the development database: their fixtures
 * delete rows, and a developer's real imported statements would go with them.
 *
 * The suite therefore runs against a separate database, derived from
 * DATABASE_URL by appending `_test` unless ORBIT_TEST_DATABASE_URL overrides it.
 */
import { Client } from 'pg';

export function resolveTestDatabaseUrl(): string {
  const override = process.env.ORBIT_TEST_DATABASE_URL;

  if (override) {
    return override;
  }

  const base = process.env.DATABASE_URL;

  if (!base) {
    throw new Error('DATABASE_URL is not set');
  }

  const url = new URL(base);
  const name = url.pathname.replace(/^\//, '');

  if (!name) {
    throw new Error('DATABASE_URL has no database name');
  }

  if (name.endsWith('_test')) {
    return base;
  }

  url.pathname = `/${name}_test`;

  return url.toString();
}

/** Creates the test database if it does not exist yet. */
export async function ensureTestDatabase(testUrl: string): Promise<void> {
  const url = new URL(testUrl);
  const name = url.pathname.replace(/^\//, '');

  // CREATE DATABASE cannot run inside the target database.
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = '/postgres';

  const client = new Client({ connectionString: adminUrl.toString() });
  await client.connect();

  try {
    const existing = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [name]);

    if (existing.rowCount === 0) {
      // The name comes from our own URL, not from user input, and identifiers
      // cannot be parameterised.
      await client.query(`CREATE DATABASE "${name.replace(/"/g, '""')}"`);
    }
  } finally {
    await client.end();
  }
}
