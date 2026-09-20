import { NextResponse } from 'next/server';

import { getActiveUser } from '@/lib/auth';
import { rematchFuelReceipts } from '@/lib/import/process-fuel-receipt';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(): Promise<NextResponse> {
  const user = await getActiveUser();

  if (!user) {
    return NextResponse.json({ error: 'Přihlaste se prosím' }, { status: 401 });
  }

  try {
    const result = await rematchFuelReceipts();

    return NextResponse.json(result);
  } catch (error: unknown) {
    console.error('Fuel receipt rematch failed', error);

    return NextResponse.json({ error: 'Spárování se nezdařilo' }, { status: 500 });
  }
}
