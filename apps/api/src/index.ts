import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { accounts } from '@orbit-api/routes/accounts';
import { auth } from '@orbit-api/routes/auth';
import { cron } from '@orbit-api/routes/cron';
import { dashboard } from '@orbit-api/routes/dashboard';
import { fuel } from '@orbit-api/routes/fuel';
import { health } from '@orbit-api/routes/health';
import { importRouter } from '@orbit-api/routes/import';
import { ingest } from '@orbit-api/routes/ingest';
import { insurance } from '@orbit-api/routes/insurance';
import { invites } from '@orbit-api/routes/invites';
import { netWorth } from '@orbit-api/routes/net-worth';
import { planning } from '@orbit-api/routes/planning';
import { portfolio } from '@orbit-api/routes/portfolio';
import { settings } from '@orbit-api/routes/settings';
import { settlement } from '@orbit-api/routes/settlement';
import { transactions } from '@orbit-api/routes/transactions';
import { users } from '@orbit-api/routes/users';

// Comma-separated so local dev can allow both apps/web (:3000) and the Expo
// web target (:8081, used for browser-based verification of apps/mobile —
// a real native app sends no Origin header at all, CORS never applies to it)
// without needing per-environment config beyond the one var.
const WEB_ORIGINS = (process.env.WEB_ORIGIN ?? 'http://localhost:3000,http://localhost:8081').split(',').map((origin: string) => origin.trim());

const app = new Hono()
  .use(
    '*',
    cors({
      origin: WEB_ORIGINS,
      credentials: true,
    }),
  )
  .route('/health', health)
  .route('/auth', auth)
  .route('/accounts', accounts)
  .route('/transactions', transactions)
  .route('/insurance', insurance)
  .route('/planning', planning)
  .route('/settlement', settlement)
  .route('/net-worth', netWorth)
  .route('/portfolio', portfolio)
  .route('/settings', settings)
  .route('/users', users)
  .route('/invites', invites)
  .route('/import', importRouter)
  .route('/dashboard', dashboard)
  .route('/fuel', fuel)
  .route('/ingest', ingest)
  .route('/cron', cron);

export type AppType = typeof app;
export default app;
