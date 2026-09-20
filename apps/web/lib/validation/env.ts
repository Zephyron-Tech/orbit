import { z } from 'zod';

/**
 * Runtime environment contract. Parsed once at import time so a missing or
 * malformed variable fails at startup rather than deep inside a request.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),

  /// Shared secret for machine-to-machine routes (cron, provider pulls).
  INGESTION_SECRET: z.string().min(32),

  /// Shared secret for the Tankarta automation bot's file uploads.
  /// Deliberately separate from INGESTION_SECRET: the bot calls over the
  /// public internet from a machine Orbit doesn't control, unlike cron's
  /// docker-internal traffic — a compromised bot secret must not also grant
  /// the ability to trigger the Trading 212 sync or net-worth snapshot cron.
  FUEL_INGESTION_SECRET: z.string().min(32),

  /// Shared secret for the bank-statement automation bot's file uploads.
  /// Deliberately separate from FUEL_INGESTION_SECRET and INGESTION_SECRET for
  /// the same reason those two are already separate: a leaked bot secret must
  /// only ever unlock the one bot it belongs to.
  BANK_STATEMENT_INGESTION_SECRET: z.string().min(32),

  /// Shared secret for the Moneta live-sync automation bot's transaction uploads.
  /// Deliberately separate from the other ingestion secrets for the same
  /// reason they're all separate: a leaked bot secret must only unlock the
  /// one bot it belongs to.
  MONETA_SYNC_INGESTION_SECRET: z.string().min(32),

  /// Auth.js signing secret.
  AUTH_SECRET: z.string().min(32),

  /** Key id as shown in the Trading 212 UI. Informational; not sent anywhere. */
  TRADING212_API_KEY_ID: z.string().default(''),
  /** The secret sent in the Authorization header. This is the actual credential. */
  TRADING212_API_SECRET: z.string().default(''),
  TRADING212_API_BASE_URL: z.url().default('https://live.trading212.com'),

  REPORTING_CURRENCY: z.string().length(3).default('CZK'),

  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
});

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

/**
 * Validates the environment on first use and caches the result.
 *
 * Deliberately lazy: `next build` imports every route module without a runtime
 * environment, so validating at import time fails the production build even
 * though the app would run fine. Reading it inside a request handler keeps the
 * check where it belongs — at the moment the value is actually needed.
 */
export function getEnv(): Env {
  if (cached) {
    return cached;
  }

  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    // Print the failing variable names only: values are secrets.
    const names = parsed.error.issues.map((issue) => issue.path.join('.')).join(', ');

    throw new Error(`Invalid environment variables: ${names}`);
  }

  cached = parsed.data;

  return cached;
}
