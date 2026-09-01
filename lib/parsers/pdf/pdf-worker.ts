import { join } from 'node:path';

import { PDFParse } from 'pdf-parse';

/**
 * pdfjs-dist (pdf-parse's dependency) resolves its worker script relative to
 * its own compiled module by default ("./pdf.worker.mjs"), which breaks once
 * Next's bundler moves the module into a chunk at an unrelated path — it
 * only ever surfaces in the Docker/standalone build, never in `next dev` or
 * a plain script, since those keep the real node_modules layout intact.
 * `require.resolve`/`createRequire` don't help here: Turbopack replaces them
 * with its own shim in the compiled server bundle, which returns an internal
 * numeric module id instead of a real path, both at build time ("collect
 * page data") and at runtime. Plain filesystem math from `process.cwd()`
 * sidesteps the bundler entirely — the Docker runner's WORKDIR and `next
 * dev`'s working directory are both the project root, and
 * `next.config.ts`'s `outputFileTracingIncludes` guarantees this exact file
 * exists at this path in the standalone build.
 *
 * Shared by every PDF parser's caller (`process-fuel-receipt.ts`,
 * `process-csv.ts`'s credit-card branch) — one place to get this right.
 */
let workerConfigured = false;

export function ensurePdfWorkerConfigured(): void {
  if (workerConfigured) return;
  PDFParse.setWorker(join(process.cwd(), 'node_modules/pdf-parse/dist/pdf-parse/cjs/pdf.worker.mjs'));
  workerConfigured = true;
}
