-- Keep existing category relations intact while moving provider contracts from
-- editable display names to immutable keys.
ALTER TABLE "Category" ADD COLUMN "key" TEXT;
ALTER TABLE "Category" ADD COLUMN "isActive" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Category"
SET "key" = CASE "name"
  WHEN 'Groceries' THEN 'groceries'
  WHEN 'Restaurants' THEN 'restaurants'
  WHEN 'Housing' THEN 'housing'
  WHEN 'Utilities' THEN 'utilities'
  WHEN 'Transport' THEN 'transport'
  WHEN 'Fuel' THEN 'fuel'
  WHEN 'Health' THEN 'health'
  WHEN 'Subscriptions' THEN 'subscriptions'
  WHEN 'Shopping' THEN 'shopping'
  WHEN 'Travel' THEN 'travel'
  WHEN 'Income' THEN 'income'
  WHEN 'Dividends' THEN 'dividends'
  WHEN 'Interest' THEN 'interest'
  WHEN 'Transfer' THEN 'transfer'
  WHEN 'Uncategorized' THEN 'uncategorized'
  ELSE 'legacy-' || "id"
END;

UPDATE "Category"
SET "name" = '__orbit_system_' || "key"
WHERE "key" IN (
  'groceries', 'restaurants', 'housing', 'utilities', 'transport', 'fuel',
  'health', 'subscriptions', 'shopping', 'travel', 'income', 'dividends',
  'interest', 'transfer', 'uncategorized'
);

UPDATE "Category"
SET "name" = "name" || ' (vlastní)'
WHERE "key" LIKE 'legacy-%'
  AND "name" IN (
    'Potraviny', 'Restaurace', 'Bydlení', 'Energie', 'Doprava', 'Palivo',
    'Zdraví', 'Předplatné', 'Nákupy', 'Cestování', 'Příjmy', 'Dividendy',
    'Úroky', 'Převody', 'Nezařazené'
  );

UPDATE "Category"
SET "name" = CASE "key"
  WHEN 'groceries' THEN 'Potraviny'
  WHEN 'restaurants' THEN 'Restaurace'
  WHEN 'housing' THEN 'Bydlení'
  WHEN 'utilities' THEN 'Energie'
  WHEN 'transport' THEN 'Doprava'
  WHEN 'fuel' THEN 'Palivo'
  WHEN 'health' THEN 'Zdraví'
  WHEN 'subscriptions' THEN 'Předplatné'
  WHEN 'shopping' THEN 'Nákupy'
  WHEN 'travel' THEN 'Cestování'
  WHEN 'income' THEN 'Příjmy'
  WHEN 'dividends' THEN 'Dividendy'
  WHEN 'interest' THEN 'Úroky'
  WHEN 'transfer' THEN 'Převody'
  WHEN 'uncategorized' THEN 'Nezařazené'
  ELSE "name"
END;

ALTER TABLE "Category" ALTER COLUMN "key" SET NOT NULL;
CREATE UNIQUE INDEX "Category_key_key" ON "Category"("key");
