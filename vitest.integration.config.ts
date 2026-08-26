import { fileURLToPath } from 'node:url';

import { config as loadDotenv } from 'dotenv';
import { defineConfig } from 'vitest/config';

import { resolveTestDatabaseUrl } from './scripts/test/integration-db';

loadDotenv();

// Every worker must see the test database, not the development one. Setting it
// here (not only in globalSetup) means a worker process can never inherit the
// developer's DATABASE_URL.
const testDatabaseUrl = resolveTestDatabaseUrl();

/** Integration tests. Require a running Postgres: `npm run db:up`. */
export default defineConfig({
  test: {
    environment: 'node',
    include: ['lib/**/*.integration.test.ts'],
    globalSetup: ['./scripts/test/global-setup.ts'],
    // They share one database, so they must not run concurrently.
    fileParallelism: false,
    env: { DATABASE_URL: testDatabaseUrl },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('.', import.meta.url)),
    },
  },
});
