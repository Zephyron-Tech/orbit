import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { accounts } from '@orbit-api/routes/accounts';
import { auth } from '@orbit-api/routes/auth';
import { health } from '@orbit-api/routes/health';
import { insurance } from '@orbit-api/routes/insurance';
import { planning } from '@orbit-api/routes/planning';
import { portfolio } from '@orbit-api/routes/portfolio';
import { settings } from '@orbit-api/routes/settings';
import { settlement } from '@orbit-api/routes/settlement';
import { transactions } from '@orbit-api/routes/transactions';
import { users } from '@orbit-api/routes/users';

const WEB_ORIGIN = process.env.WEB_ORIGIN ?? 'http://localhost:3000';

const app = new Hono()
  .use(
    '*',
    cors({
      origin: WEB_ORIGIN,
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
  .route('/portfolio', portfolio)
  .route('/settings', settings)
  .route('/users', users);

export type AppType = typeof app;
export default app;
