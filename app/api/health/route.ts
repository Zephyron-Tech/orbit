import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db/prisma';

// Prisma needs the Node.js runtime, and this route must never be cached.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Liveness + database readiness probe, used by the Docker healthcheck. */
export async function GET(): Promise<NextResponse> {
  try {
    await prisma.$queryRaw`SELECT 1`;

    return NextResponse.json({ status: 'ok', database: 'up' });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'unknown error';

    return NextResponse.json({ status: 'error', database: 'down', message }, { status: 503 });
  }
}
