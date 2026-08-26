'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';

export interface UserActionResult {
  ok: boolean;
  error?: string;
}

const userSchema = z.object({
  id: z.uuid(),
  name: z.string().trim().max(120).nullable().transform((value) => value || null),
  email: z.email().transform((value) => value.trim().toLowerCase()),
  role: z.enum(['OWNER', 'MEMBER']),
  isActive: z.boolean(),
});

async function activeOwner(): Promise<{ id: string } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;
  return prisma.user.findFirst({ where: { id: session.user.id, role: 'OWNER', isActive: true }, select: { id: true } });
}

export async function updateHouseholdUser(input: z.input<typeof userSchema>): Promise<UserActionResult> {
  const actor = await activeOwner();
  if (!actor) return { ok: false, error: 'Správu členů může měnit pouze aktivní vlastník.' };

  const parsed = userSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: 'Zkontrolujte jméno, e-mail a zvolenou roli.' };
  try {
    await prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(742021)`;
      const target = await tx.user.findUnique({ where: { id: parsed.data.id } });
      if (!target) throw new UserManagementError('Uživatel už neexistuje.');
      if (target.id === actor.id && (parsed.data.role !== 'OWNER' || !parsed.data.isActive)) {
        throw new UserManagementError('Vlastní účet nelze deaktivovat ani převést na člena.');
      }
      const removesActiveOwner = target.role === 'OWNER' && target.isActive && (parsed.data.role !== 'OWNER' || !parsed.data.isActive);
      if (removesActiveOwner) {
        const ownerCount = await tx.user.count({ where: { role: 'OWNER', isActive: true } });
        if (ownerCount <= 1) throw new UserManagementError('Domácnost musí mít alespoň jednoho aktivního vlastníka.');
      }
      await tx.user.update({
        where: { id: target.id },
        data: { name: parsed.data.name, email: parsed.data.email, role: parsed.data.role, isActive: parsed.data.isActive },
      });
    });
  } catch (error: unknown) {
    if (error instanceof UserManagementError) return { ok: false, error: error.message };
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'Tento e-mail už používá jiný účet.' };
    }
    console.error('Household user update failed', error);
    return { ok: false, error: 'Účet se nepodařilo uložit.' };
  }

  revalidatePath('/settings/users');
  return { ok: true };
}

class UserManagementError extends Error {}

export async function revokeInvite(id: string): Promise<UserActionResult> {
  const actor = await activeOwner();
  if (!actor) return { ok: false, error: 'Pozvánku může zrušit pouze aktivní vlastník.' };
  const parsed = z.uuid().safeParse(id);
  if (!parsed.success) return { ok: false, error: 'Neplatná pozvánka.' };

  await prisma.invite.deleteMany({ where: { id: parsed.data, acceptedAt: null } });
  revalidatePath('/settings/users');
  return { ok: true };
}
