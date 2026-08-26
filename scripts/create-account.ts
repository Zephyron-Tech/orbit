/**
 * Creates or updates an account. Orbit has no account management UI yet, and a
 * CSV import needs an account to file the transactions under.
 *
 * Usage:
 *   npx tsx scripts/create-account.ts --name "Moneta" --provider MONETA \
 *     --type CHECKING --external-id "204370628/0600"
 */
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../lib/generated/prisma/client';
import type { AccountType, Provider } from '../lib/generated/prisma/enums';

const ACCOUNT_TYPES = ['CHECKING', 'SAVINGS', 'INVESTMENT', 'CREDIT'] as const;
const PROVIDERS = ['MONETA', 'REVOLUT', 'TRADING212', 'MANUAL'] as const;

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? undefined : process.argv[index + 1];
}

function requireFlag(name: string): string {
  const value = readFlag(name);

  if (!value) {
    throw new Error(`Missing required flag --${name}`);
  }

  return value;
}

function assertOneOf<T extends string>(value: string, allowed: readonly T[], flag: string): T {
  const match = allowed.find((candidate) => candidate === value);

  if (!match) {
    throw new Error(`--${flag} must be one of: ${allowed.join(', ')}`);
  }

  return match;
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const name = requireFlag('name');
  const provider: Provider = assertOneOf(requireFlag('provider'), PROVIDERS, 'provider');
  const type: AccountType = assertOneOf(requireFlag('type'), ACCOUNT_TYPES, 'type');
  const externalId = readFlag('external-id') ?? null;
  const currency = readFlag('currency') ?? 'CZK';

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // The compound unique index cannot match on a null externalId, so an
    // account without one is looked up by name instead.
    const existing = externalId
      ? await prisma.account.findUnique({ where: { provider_externalId: { provider, externalId } } })
      : await prisma.account.findFirst({ where: { provider, name } });

    const account = existing
      ? await prisma.account.update({
          where: { id: existing.id },
          data: { name, type, currency, externalId },
        })
      : await prisma.account.create({ data: { name, type, provider, externalId, currency } });

    console.log(`Account ${account.id}: ${account.name} (${account.provider}, ${account.externalId ?? 'no id'})`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
