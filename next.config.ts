import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit .next/standalone so the Docker runtime image does not need node_modules.
  output: 'standalone',

  outputFileTracingIncludes: {
    // The Prisma client is generated outside node_modules, so file tracing cannot
    // discover it from imports alone. Include it explicitly for every route.
    '/**/*': ['./lib/generated/prisma/**/*'],
    // pdf-parse's pdfjs-dist dependency loads @napi-rs/canvas via a
    // try/catch dynamic require (it's an optional peer, used for Node's
    // missing DOMMatrix/ImageData/Path2D polyfills) — Next's static tracer
    // never sees that require and drops it from the standalone build,
    // which crashes with "DOMMatrix is not defined" only in Docker, never
    // in plain `next dev` (full node_modules) or a standalone tsx script.
    '/api/import/fuel-receipt/**/*': [
      './node_modules/@napi-rs/canvas*/**/*',
      // pdfjs-dist's worker script, resolved manually at runtime — see the
      // comment in lib/import/process-fuel-receipt.ts. The tracer only
      // follows static imports, and this file is reached via
      // require.resolve() at runtime, so it needs an explicit include too.
      './node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs',
    ],
  },
};

export default nextConfig;
