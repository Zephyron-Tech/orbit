import { NextResponse } from 'next/server';

import { recordNetWorthSnapshot } from '@/lib/finance/net-worth-service';
import { getEnv } from '@/lib/validation/env';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/** Constant-time comparison, so the shared secret cannot be timed out of the server. */
function secretMatches(provided: string, expected: string): boolean {
  if (provided.length !== expected.length) {
    return false;
  }

  let mismatch = 0;

  for (let index = 0; index < provided.length; index += 1) {
    mismatch |= provided.charCodeAt(index) ^ expected.charCodeAt(index);
  }

  return mismatch === 0;
}

async function handle(request: Request): Promise<NextResponse> {
  const env = getEnv();
  const header = request.headers.get('authorization') ?? '';
  const provided = header.startsWith('Bearer ') ? header.slice('Bearer '.length) : header;

  if (!secretMatches(provided, env.INGESTION_SECRET)) {
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
