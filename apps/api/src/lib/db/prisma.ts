import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '@orbit-api/lib/generated/prisma/client';

// Next.js hot-reloads modules in development, which would otherwise open a new
// connection pool on every reload. Cache the client on globalThis.
const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrismaClient(): PrismaClient {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  // Prisma 7 requires an explicit driver adapter; the URL no longer lives in the schema.
  const adapter = new PrismaPg({ connectionString });

  return new PrismaClient({
    adapter,
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });
}

export const prisma = globalForPrisma.prisma ?? createPrismaClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}
