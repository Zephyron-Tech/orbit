'use server';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { getActiveUser } from '@/lib/auth';
import { prisma } from '@/lib/db/prisma';
import { Prisma } from '@/lib/generated/prisma/client';
import { PaymentFrequency, PolicyStatus } from '@/lib/generated/prisma/enums';

const dateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Datum zadejte ve formátu RRRR-MM-DD')
  .refine((value) => {
    const date = new Date(`${value}T00:00:00.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Zadejte platné datum');

const insurancePolicySchema = z.object({
  vehicleName: z.string().trim().min(1, 'Zadejte název vozidla').max(120),
  licensePlate: z.string().trim().min(1, 'Zadejte SPZ').max(20),
  policyNumber: z.string().trim().min(1, 'Zadejte číslo pojistky').max(60),
  policyHolder: z.string().trim().min(1, 'Zadejte pojistníka').max(120),
  /** Always the full yearly premium — `paymentFrequency` only changes the installment cadence. */
  annualCost: z
    .string()
    .trim()
    .refine((value) => /^\d+([.,]\d{1,4})?$/.test(value), 'Zadejte kladnou částku, např. 12000')
    .transform((value) => value.replace(',', '.')),
  paymentFrequency: z.enum(PaymentFrequency),
  startDate: dateString,
  status: z.enum(PolicyStatus),
});

export type InsurancePolicyInput = z.infer<typeof insurancePolicySchema>;

export interface ActionResult {
  ok: boolean;
  error?: string;
}

function firstIssue(error: z.ZodError): string {
  return error.issues[0]?.message ?? 'Neplatná data';
}

function toPrismaData(input: InsurancePolicyInput) {
  return {
    vehicleName: input.vehicleName,
    licensePlate: input.licensePlate,
    policyNumber: input.policyNumber,
    policyHolder: input.policyHolder,
    annualCost: new Prisma.Decimal(input.annualCost),
    paymentFrequency: input.paymentFrequency,
    startDate: new Date(`${input.startDate}T00:00:00.000Z`),
    status: input.status,
  };
}

export async function createInsurancePolicy(input: InsurancePolicyInput): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsed = insurancePolicySchema.safeParse(input);

  if (!parsed.success) {
    return { ok: false, error: firstIssue(parsed.error) };
  }

  try {
    await prisma.insurancePolicy.create({ data: toPrismaData(parsed.data) });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'Toto číslo pojistky už je evidované' };
    }
    throw error;
  }

  revalidatePath('/settings/insurance');

  return { ok: true };
}

export async function updateInsurancePolicy(id: string, input: InsurancePolicyInput): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);
  const parsed = insurancePolicySchema.safeParse(input);

  if (!parsedId.success || !parsed.success) {
    return { ok: false, error: parsed.success ? 'Neplatná pojistka' : firstIssue(parsed.error) };
  }

  try {
    await prisma.insurancePolicy.update({ where: { id: parsedId.data }, data: toPrismaData(parsed.data) });
  } catch (error: unknown) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
      return { ok: false, error: 'Toto číslo pojistky už je evidované' };
    }
    throw error;
  }

  revalidatePath('/settings/insurance');

  return { ok: true };
}

export async function deleteInsurancePolicy(id: string): Promise<ActionResult> {
  const user = await getActiveUser();

  if (!user) {
    return { ok: false, error: 'Přihlaste se prosím' };
  }

  const parsedId = z.uuid().safeParse(id);

  if (!parsedId.success) {
    return { ok: false, error: 'Neplatná pojistka' };
  }

  await prisma.insurancePolicy.delete({ where: { id: parsedId.data } });

  revalidatePath('/settings/insurance');

  return { ok: true };
}
