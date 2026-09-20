import 'dotenv/config';

import { serve } from '@hono/node-server';

import app from './index';

const port = Number(process.env.PORT ?? 4000);

serve({ fetch: app.fetch, port }, (info) => {
  console.log(`Orbit API listening on http://localhost:${info.port}`);
});
