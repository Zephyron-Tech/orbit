import 'dotenv/config';

import { rebuildMonthlyNetWorth } from '@/lib/finance/monthly-net-worth-service';

function flag(name: string): string | null {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? null : process.argv[index + 1] ?? null;
}

const from = flag('from');
const to = flag('to');

if (!from || !to || !/^\d{4}-\d{2}$/.test(from) || !/^\d{4}-\d{2}$/.test(to)) {
  throw new Error('Usage: npx tsx scripts/backfill-monthly-net-worth.ts --from YYYY-MM --to YYYY-MM');
}

void rebuildMonthlyNetWorth(new Date(`${from}-01T00:00:00.000Z`), new Date(`${to}-01T00:00:00.000Z`)).then((count) => {
  console.log(`Rebuilt ${count} monthly net-worth points.`);
});
