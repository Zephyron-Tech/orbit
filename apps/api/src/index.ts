import { Hono } from 'hono';
import { cors } from 'hono/cors';

import { accounts } from '@orbit-api/routes/accounts';
import { auth } from '@orbit-api/routes/auth';
import { health } from '@orbit-api/routes/health';

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
  .route('/accounts', accounts);

export type AppType = typeof app;
export default app;
