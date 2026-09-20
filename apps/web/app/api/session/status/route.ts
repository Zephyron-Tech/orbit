import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';

export const dynamic = 'force-dynamic';

export async function GET(): Promise<NextResponse> {
  const session = await auth();
  if (!session?.user?.id) return NextResponse.json({ active: false }, { status: 401 });

  const user = await prisma.user.findUnique({ where: { id: session.user.id }, select: { isActive: true } });
  return NextResponse.json({ active: user?.isActive === true });
}
