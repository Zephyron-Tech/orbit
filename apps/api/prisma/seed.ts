import 'dotenv/config';

import { PrismaPg } from '@prisma/adapter-pg';

import { PrismaClient } from '../src/lib/generated/prisma/client';

// Keys are provider contracts; Czech names remain user-editable display copy.
const CATEGORIES: ReadonlyArray<{ key: string; name: string; icon: string; defaultIsShared: boolean }> = [
  { key: 'groceries', name: 'Potraviny', icon: 'shopping-cart', defaultIsShared: true },
  { key: 'restaurants', name: 'Restaurace', icon: 'utensils', defaultIsShared: true },
  { key: 'housing', name: 'Bydlení', icon: 'home', defaultIsShared: true },
  { key: 'utilities', name: 'Energie', icon: 'zap', defaultIsShared: true },
  { key: 'transport', name: 'Doprava', icon: 'bus', defaultIsShared: false },
  { key: 'fuel', name: 'Palivo', icon: 'fuel', defaultIsShared: false },
  { key: 'health', name: 'Zdraví', icon: 'heart-pulse', defaultIsShared: false },
  { key: 'subscriptions', name: 'Předplatné', icon: 'repeat', defaultIsShared: false },
  { key: 'shopping', name: 'Nákupy', icon: 'shopping-bag', defaultIsShared: false },
  { key: 'travel', name: 'Cestování', icon: 'plane', defaultIsShared: true },
  { key: 'income', name: 'Příjmy', icon: 'banknote', defaultIsShared: false },
  { key: 'dividends', name: 'Dividendy', icon: 'trending-up', defaultIsShared: false },
  { key: 'interest', name: 'Úroky', icon: 'percent', defaultIsShared: false },
  { key: 'transfer', name: 'Převody', icon: 'arrow-left-right', defaultIsShared: false },
  { key: 'one_time_income', name: 'Jednorázový příjem', icon: 'gift', defaultIsShared: false },
  { key: 'uncategorized', name: 'Nezařazené', icon: 'circle-help', defaultIsShared: false },
];

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error('DATABASE_URL is not set');
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    for (const category of CATEGORIES) {
      await prisma.category.upsert({
        where: { key: category.key },
        update: { icon: category.icon, defaultIsShared: category.defaultIsShared },
        create: category,
      });
    }

    console.log(`Seeded ${CATEGORIES.length} categories.`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
