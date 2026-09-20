import { NextResponse } from 'next/server';

// Liveness only now — apps/web no longer owns a database connection to
// probe; that check lives at the API's own GET /health.
export const dynamic = 'force-dynamic';

export function GET(): NextResponse {
  return NextResponse.json({ status: 'ok' });
}
