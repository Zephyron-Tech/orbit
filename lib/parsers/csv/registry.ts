import type { Provider } from '@/lib/generated/prisma/enums';

import { parseMonetaCsv } from './moneta';
import type { CsvParser } from './types';

/**
 * Provider to parser. A plain map, not a plugin system: adding Revolut means
 * adding one function and one entry here.
 */
export const CSV_PARSERS: Partial<Record<Provider, CsvParser>> = {
  MONETA: parseMonetaCsv,
};

export function getCsvParser(provider: Provider): CsvParser {
  const parser = CSV_PARSERS[provider];

  if (!parser) {
    throw new Error(`No CSV parser registered for provider ${provider}`);
  }

  return parser;
}
