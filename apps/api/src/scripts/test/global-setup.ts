import { execFileSync } from 'node:child_process';

import { config as loadDotenv } from 'dotenv';

import { ensureTestDatabase, resolveTestDatabaseUrl } from './integration-db';

/**
 * Vitest global setup for the integration suite: point every worker at a
 * dedicated database and bring its schema up to date before any test runs.
 */
export default async function setup(): Promise<void> {
  loadDotenv();

  const testUrl = resolveTestDatabaseUrl();

  await ensureTestDatabase(testUrl);

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });

  execFileSync('npx', ['prisma', 'db', 'seed'], {
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: 'inherit',
  });

  process.env.DATABASE_URL = testUrl;
}
