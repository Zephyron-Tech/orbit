UPDATE "Transaction" AS t
SET
  "kind" = 'PENDING_TRANSFER',
  "categoryId" = c."id"
FROM "Account" AS a
JOIN "Category" AS c ON c."key" = 'transfer'
WHERE t."accountId" = a."id"
  AND a."provider" = 'MONETA'
  AND t."kind" = 'NORMAL'
  AND t."amount" < 0
  AND (COALESCE(t."merchant", '') || ' ' || COALESCE(t."description", '')) ILIKE '%TRADING 212%';
