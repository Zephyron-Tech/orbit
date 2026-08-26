import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit .next/standalone so the Docker runtime image does not need node_modules.
  output: 'standalone',

  // The Prisma client is generated outside node_modules, so file tracing cannot
  // discover it from imports alone. Include it explicitly for every route.
  outputFileTracingIncludes: {
    '/**/*': ['./lib/generated/prisma/**/*'],
  },
};

export default nextConfig;
