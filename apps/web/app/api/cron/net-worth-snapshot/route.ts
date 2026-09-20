import { NextResponse } from 'next/server';

import { recordNetWorthSnapshot } from '@/lib/finance/net-worth-service';
import { isIngestionAuthorized } from '@/lib/auth/ingestion-secret';
import { getEnv } from '@/lib/validation/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function handle(request: Request): Promise<NextResponse> {
  const env = getEnv();

  if (!isIngestionAuthorized(request, env.INGESTION_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    return NextResponse.json(await recordNetWorthSnapshot());
  } catch (error: unknown) {
    console.error('Net worth snapshot failed', error);

    return NextResponse.json({ error: 'Snapshot failed' }, { status: 500 });
  }
}

export async function GET(request: Request): Promise<NextResponse> {
  return handle(request);
}

export async function POST(request: Request): Promise<NextResponse> {
  return handle(request);
}
