'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { hashPassword, verifyPassword, WeakPasswordError } from '@/lib/auth/password';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { isPeriod } from '@/lib/ui/period';

export interface ActionResult {
  ok: boolean;
  error?: string;
}

const emailSchema = z.email().transform((value) => value.trim().toLowerCase());

export async function changeMyEmail(email: string): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = emailSchema.safeParse(email);

  if (!parsed.success) {
    return { ok: false, error: 'Zadejte platný e-mail' };
  }

  try {
    await prisma.user.update({ where: { id: user.id }, data: { email: parsed.data } });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'Tento e-mail už používá jiný účet' };
    }
    throw error;
  }

  revalidatePath('/settings');

  return { ok: true };
}

const passwordSchema = z.object({
  currentPassword: z.string().min(1, 'Zadejte současné heslo'),
  newPassword: z.string().min(1, 'Zadejte nové heslo'),
});

export async function changeMyPassword(input: z.input<typeof passwordSchema>): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = passwordSchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Neplatný vstup' };
  }

  const row = await prisma.user.findUnique({ where: { id: user.id }, select: { passwordHash: true } });

  if (!row || !(await verifyPassword(parsed.data.currentPassword, row.passwordHash))) {
    return { ok: false, error: 'Současné heslo není správné' };
  }

  let newHash: string;

  try {
    newHash = await hashPassword(parsed.data.newPassword);
  } catch (error: unknown) {
    if (error instanceof WeakPasswordError) {
      return { ok: false, error: 'Heslo musí mít alespoň 10 znaků' };
    }
    throw error;
  }

  await prisma.user.update({ where: { id: user.id }, data: { passwordHash: newHash } });

  return { ok: true };
}

export async function updateReportingStartMonth(month: string | null): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  if (month !== null && !isPeriod(month)) {
    return { ok: false, error: 'Neplatný měsíc' };
  }

  const reportingStartMonth = month ? new Date(`${month}-01T00:00:00.000Z`) : null;

  await prisma.planningSettings.upsert({
    where: { id: 'household' },
    create: { id: 'household', reportingStartMonth },
    update: { reportingStartMonth },
  });

  revalidatePath('/settings');
  revalidatePath('/transactions');
  revalidatePath('/dashboard');

  return { ok: true };
}
