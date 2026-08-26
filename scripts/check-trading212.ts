/**
 * Checks that TRADING212_API_SECRET works, without writing anything to the
 * database. Prints what each endpoint answered, never the key itself.
 *
 * Usage: npx tsx scripts/check-trading212.ts
 */
import 'dotenv/config';

import { Trading212Client, Trading212Error } from '../lib/providers/trading212/client';

async function main(): Promise<void> {
  const keyId = process.env.TRADING212_API_KEY_ID;
  const secret = process.env.TRADING212_API_SECRET;
  const baseUrl = process.env.TRADING212_API_BASE_URL ?? 'https://live.trading212.com';

  if (!keyId || !secret) {
    throw new Error('TRADING212_API_KEY_ID and TRADING212_API_SECRET must both be set in .env');
  }

  console.log(`Base URL: ${baseUrl}`);
  console.log(`Key id:   ${keyId.length} characters, secret ${secret.length} (values not printed)`);

  const client = new Trading212Client({ keyId, secret, baseUrl });

  try {
    const summary = await client.getAccountSummary();
    console.log(
      `account/summary OK  currency=${summary.currency} total=${summary.totalValue} ` +
        `invested=${summary.investments.currentValue} unrealized=${summary.investments.unrealizedProfitLoss}`,
    );

    const positions = await client.getPositions();
    console.log(`positions       OK  ${positions.length} open`);

    for (const position of positions.slice(0, 10)) {
      console.log(
        `  ${position.instrument.ticker.padEnd(14)} qty=${position.quantity} ` +
          `value=${position.walletImpact.currentValue} pnl=${position.walletImpact.unrealizedProfitLoss}`,
      );
    }

    const dividends = await client.getDividends();
    console.log(`dividends       OK  ${dividends.length} paid out`);

    for (const dividend of dividends.slice(0, 10)) {
      console.log(`  ${dividend.paidOn}  ${dividend.ticker.padEnd(14)} ${dividend.amount} ${dividend.currency}`);
    }

    const history = await client.getTransactionHistory();
    const interest = history.filter((item) => item.type === 'INTEREST_ON_FREE_CASH');
    console.log(`transactions    OK  ${history.length} total, ${interest.length} interest on free cash`);

    for (const item of interest.slice(0, 10)) {
      console.log(`  ${item.dateTime}  ${item.amount} ${item.currency}`);
    }
  } catch (error: unknown) {
    if (error instanceof Trading212Error) {
      console.error(`\nFAILED on ${error.endpoint || 'setup'} (HTTP ${error.status}): ${error.message}`);

      if (error.status === 401 || error.status === 403) {
        console.error(
          [
            '',
            'Things to check in Trading 212 (Settings -> API):',
            '  1. TRADING212_API_KEY_ID is the key id and TRADING212_API_SECRET the secret;',
            '     they are sent as HTTP Basic username and password, in that order.',
            '  2. The key exists and has not been revoked.',
            '  3. It was generated for this environment (live keys do not work on demo).',
            '  4. Neither value has quotes or trailing whitespace in .env.',
          ].join('\n'),
        );
      }

      process.exit(1);
    }

    throw error;
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
