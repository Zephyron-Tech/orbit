import 'dotenv/config';

import { defineConfig, env } from 'prisma/config';

// Prisma 7 keeps the connection URL out of schema.prisma. Migrate and introspect
// read it from here; the runtime client gets it through the pg driver adapter
// in lib/db/prisma.ts.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'npx tsx prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
