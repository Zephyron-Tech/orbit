// Parses a Trading 212 snapshot's raw provider payload (stored verbatim in
// AccountSnapshot.rawData) the same way apps/web's portfolio page does —
// without pulling in zod as a new mobile dependency, since the shape here
// is small and stable enough for plain runtime guards.

export interface PortfolioPosition {
  id: string;
  ticker: string;
  name: string;
  value: number;
  unrealizedProfitLoss: number;
  quantity: number;
}

export interface ParsedSnapshot {
  positions: PortfolioPosition[];
  totalCost: number | null;
  integrityIssues: string[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parsePosition(value: unknown): PortfolioPosition | null {
  if (!isRecord(value)) return null;
  const instrument = value.instrument;
  const walletImpact = value.walletImpact;
  if (!isRecord(instrument) || !isRecord(walletImpact)) return null;

  const ticker = instrument.ticker;
  const currentValue = walletImpact.currentValue;
  const unrealizedProfitLoss = walletImpact.unrealizedProfitLoss;
  const quantity = value.quantity;

  if (typeof ticker !== 'string' || typeof currentValue !== 'number' || typeof unrealizedProfitLoss !== 'number' || typeof quantity !== 'number') {
    return null;
  }

  const isin = typeof instrument.isin === 'string' ? instrument.isin : null;
  const name = typeof instrument.name === 'string' ? instrument.name : ticker;

  return { id: isin ?? ticker, ticker, name, value: currentValue, unrealizedProfitLoss, quantity };
}

function parsePositions(value: unknown): { positions: PortfolioPosition[]; ok: boolean } {
  if (!Array.isArray(value)) return { positions: [], ok: false };
  const parsed = value.map(parsePosition);
  if (parsed.some((position) => position === null)) return { positions: [], ok: false };
  return { positions: parsed as PortfolioPosition[], ok: true };
}

function parseTotalCost(value: unknown): { totalCost: number | null; ok: boolean } {
  if (!isRecord(value)) return { totalCost: null, ok: false };
  const investments = value.investments;
  if (!isRecord(investments) || typeof investments.totalCost !== 'number') return { totalCost: null, ok: false };
  return { totalCost: investments.totalCost, ok: true };
}

export function parseSnapshotRawData(rawData: unknown): ParsedSnapshot {
  const record = isRecord(rawData) ? rawData : {};
  const { positions, ok: positionsOk } = parsePositions(record.positions);
  const { totalCost, ok: summaryOk } = parseTotalCost(record.summary);

  const integrityIssues: string[] = [];
  if (!positionsOk) integrityIssues.push('seznam pozic');
  if (!summaryOk) integrityIssues.push('souhrn účtu');

  return { positions: positionsOk ? positions : [], totalCost: summaryOk ? totalCost : null, integrityIssues };
}
