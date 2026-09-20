import path from 'node:path';

import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // Emit .next/standalone so the Docker runtime image does not need node_modules.
  output: 'standalone',
  // In a pnpm workspace, file tracing has to be told the real monorepo root —
  // without it, Next traces relative to apps/web alone and silently drops
  // packages that live in pnpm's content-addressable store one level up
  // (e.g. @swc/helpers), which only fails at container startup ("Cannot find
  // module"), never during `next build` itself or in `next dev`.
  outputFileTracingRoot: path.join(import.meta.dirname, '../..'),
  // Next's own `@swc/helpers` dependency ships both a `cjs/` and an `esm/`
  // build; the static file tracer only follows the one Next's own webpack
  // bundle statically imports (cjs) and drops `esm/` even though Node's
  // require-hook falls back to it at runtime for some module shapes — a
  // standalone-build-only failure, invisible in `next dev` or `next build`
  // itself, only surfacing as "Cannot find module ... @swc/helpers" the
  // moment `node server.js` actually runs. Same class of gap this app's
  // tracer has hit before (see git history for the pdf-parse/@napi-rs/canvas
  // case that existed before the Prisma/parsers moved to apps/api) — the fix
  // is the same: tell the tracer about the file by hand.
  outputFileTracingIncludes: {
    '/**/*': ['../../node_modules/.pnpm/@swc+helpers@*/node_modules/@swc/helpers/**/*'],
  },
};

export default nextConfig;
