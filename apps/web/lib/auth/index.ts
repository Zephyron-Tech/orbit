import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { z } from 'zod';

import { prisma } from '@/lib/db/prisma';

import { authConfig } from './config';
import { verifyPassword } from './password';

const credentialsSchema = z.object({
  email: z.email(),
  password: z.string().min(1),
});

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      credentials: {
        email: { label: 'E-mail', type: 'email' },
        password: { label: 'Heslo', type: 'password' },
      },
      async authorize(rawCredentials: unknown) {
        const parsed = credentialsSchema.safeParse(rawCredentials);

        if (!parsed.success) {
          return null;
        }

        const user = await prisma.user.findUnique({
          where: { email: parsed.data.email.toLowerCase() },
        });

        // Verify even when the user is missing, so a wrong e-mail and a wrong
        // password take the same amount of time and cannot be told apart.
        const storedHash = user?.passwordHash ?? '';
        const passwordMatches = await verifyPassword(parsed.data.password, storedHash);

        if (!user || !user.isActive || !passwordMatches) {
          return null;
        }

        await prisma.user.update({
          where: { id: user.id },
          data: { lastLogin: new Date() },
        });

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role,
        };
      },
    }),
  ],
});

/** Throws when there is no session. For route handlers that must be signed in. */
export async function requireSession(): Promise<{ id: string; email: string; role: string }> {
  const session = await auth();

  if (!session?.user) {
    throw new UnauthorizedError();
  }

  return { id: session.user.id, email: session.user.email, role: session.user.role };
}

export async function getActiveUser(): Promise<{ id: string; email: string; role: 'OWNER' | 'MEMBER' } | null> {
  const session = await auth();
  if (!session?.user?.id) return null;

  return prisma.user.findFirst({
    where: { id: session.user.id, isActive: true },
    select: { id: true, email: true, role: true },
  });
}

export class UnauthorizedError extends Error {
  constructor() {
    super('Authentication required');
    this.name = 'UnauthorizedError';
  }
}
