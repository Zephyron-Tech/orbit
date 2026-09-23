import { prisma } from '@orbit-api/lib/db/prisma';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsersBatch, type NotifiableEntity } from '../notify';
import { pluralizeCs } from '../pluralize';

export async function checkFailedImportRow(): Promise<number> {
  const rows = await prisma.ingestionEvent.findMany({
    where: { status: 'FAILED' },
    select: { id: true, provider: true, errorMessage: true },
  });

  const entities: NotifiableEntity[] = rows.map((row) => ({
    dedupeKey: row.id,
    title: 'Řádek importu selhal',
    body: `${row.provider} — ${row.errorMessage ?? 'nepodařilo se zpracovat řádek'}. Zkontrolujte import.`,
    data: { type: 'failed-import', ingestionEventId: row.id },
  }));

  return notifyEligibleUsersBatch(NotificationType.FAILED_IMPORT_ROW, entities, (newEntities) => ({
    title: 'Chyby importu',
    body: `${newEntities.length} ${pluralizeCs(newEntities.length, 'řádek importu selhal', 'řádky importu selhaly', 'řádků importu selhalo')}. Zkontrolujte import.`,
    data: { type: 'failed-import-batch', count: newEntities.length },
  }));
}
