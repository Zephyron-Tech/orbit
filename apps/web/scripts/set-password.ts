/**
 * Sets a user's password from the command line. Orbit has no password change
 * screen yet, and an account must not be stuck on whatever it was created with.
 *
 * Usage:
 *   npx tsx scripts/set-password.ts --email hello@example.com --password "new secret"
 *
 * Passing the password as an argument leaves it in the shell history; prefix the
 * command with a space, or pipe it in via ORBIT_NEW_PASSWORD instead.
 */
import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { hashPassword } from '../lib/auth/password';
import { PrismaClient } from '../lib/generated/prisma/client';

function readFlag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);

  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const email = readFlag('email')?.trim().toLowerCase();
  const password = readFlag('password') ?? process.env.ORBIT_NEW_PASSWORD;

  if (!email) {
    throw new Error('Missing required flag --email');
  }

  if (!password) {
    throw new Error('Provide --password or set ORBIT_NEW_PASSWORD');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    // hashPassword enforces the minimum length, so a weak password fails here.
    const passwordHash = await hashPassword(password);

    const updated = await prisma.user.updateMany({
      where: { email },
      data: { passwordHash },
    });

    if (updated.count === 0) {
      throw new Error(`No user with e-mail ${email}`);
    }

    console.log(`Password updated for ${email}`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
