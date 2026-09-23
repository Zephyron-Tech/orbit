import { prisma } from '@orbit-api/lib/db/prisma';
import { NotificationType } from '@orbit-api/lib/generated/prisma/enums';

import { notifyEligibleUsers } from '../notify';

export async function checkFailedImportRow(): Promise<number> {
  const rows = await prisma.ingestionEvent.findMany({
    where: { status: 'FAILED' },
    select: { id: true, provider: true, errorMessage: true },
  });

  let sent = 0;
  for (const row of rows) {
    const dedupeKey = row.id;
    sent += await notifyEligibleUsers(NotificationType.FAILED_IMPORT_ROW, dedupeKey, {
      title: 'Řádek importu selhal',
      body: `${row.provider} — ${row.errorMessage ?? 'nepodařilo se zpracovat řádek'}. Zkontrolujte import.`,
      data: { type: 'failed-import', ingestionEventId: row.id },
    });
  }
  return sent;
}
