import { NextResponse } from 'next/server';

import { isIngestionAuthorized } from '@/lib/auth/ingestion-secret';
import { prisma } from '@/lib/db/prisma';
import { getEnv } from '@/lib/validation/env';

/**
 * Lets the bank-statement automation bot discover which `accountId` to send
 * with each statement upload, keyed by the bank's own account number — the
 * same identifier the bot can read off the mailed statement itself.
 */

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request: Request): Promise<NextResponse> {
  const env = getEnv();

  if (!isIngestionAuthorized(request, env.BANK_STATEMENT_INGESTION_SECRET)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const accounts = await prisma.account.findMany({
    where: { isArchived: false },
    orderBy: [{ sortOrder: 'asc' }, { name: 'asc' }],
    select: { id: true, name: true, type: true, provider: true, externalId: true },
  });

  return NextResponse.json({
    accounts: accounts.map((account) => ({
      id: account.id,
      name: account.name,
      type: account.type,
      provider: account.provider,
      accountNumber: account.externalId,
    })),
  });
}
