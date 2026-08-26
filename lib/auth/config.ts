import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe half of the Auth.js configuration. The middleware imports only this
 * file, so Prisma and node:crypto never end up in the middleware bundle.
 */
export const authConfig = {
  session: { strategy: 'jwt' },
  pages: {
    signIn: '/signin',
  },
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.userId = user.id;
        token.role = 'role' in user && typeof user.role === 'string' ? user.role : 'MEMBER';
      }

      return token;
    },
    session({ session, token }) {
      if (typeof token.userId === 'string') {
        session.user.id = token.userId;
      }

      if (typeof token.role === 'string') {
        session.user.role = token.role === 'OWNER' ? 'OWNER' : 'MEMBER';
      }

      return session;
    },
  },
  providers: [],
} satisfies NextAuthConfig;
