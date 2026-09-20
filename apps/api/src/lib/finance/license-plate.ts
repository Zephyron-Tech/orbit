import type { VehicleCategory } from '@orbit-api/lib/generated/prisma/enums';

/**
 * Cosmetic display grouping for a Czech registration plate (SPZ/RZ).
 * `licensePlate` itself stays an unformatted string in the database — this
 * only affects how it's shown.
 *
 * Real plate-length rules (verified against real sample plates and public
 * sources), by vehicle category:
 *   - car, standard-issue: 7 chars, grouped 3+4 (e.g. "7C7 3505")
 *   - car, "na přání" (custom): 8 chars, grouped 3+5
 *   - motorcycle, standard-issue: 6 chars, grouped 2+4 (e.g. "9C 3342")
 *   - motorcycle, "na přání": 7 chars, grouped 2+5
 *   - moped: 5 chars, ungrouped
 *
 * Length alone doesn't disambiguate a 7-char plate (standard car vs. "na
 * přání" motorcycle) — the vehicle category is what tells them apart, so it
 * is a required argument rather than inferred from the string.
 *
 * Any length/category combination not in this table (trucks, buses,
 * trailers — no single documented fixed grouping) falls back to the raw
 * string unchanged. Never throws: this is display only.
 */
export function formatLicensePlate(raw: string, vehicleType: VehicleCategory): string {
  const value = raw.trim().toUpperCase().replace(/\s+/g, '');

  if (!value) {
    return value;
  }

  const split = groupLengthFor(value.length, vehicleType);

  if (!split) {
    return value;
  }

  return `${value.slice(0, split)} ${value.slice(split)}`;
}

/** Returns where to put the single grouping space, or null to leave the plate as-is. */
function groupLengthFor(length: number, vehicleType: VehicleCategory): number | null {
  if (vehicleType === 'CAR') {
    if (length === 7) return 3; // standard: 3+4
    if (length === 8) return 3; // na přání: 3+5
  }

  if (vehicleType === 'MOTORCYCLE') {
    if (length === 6) return 2; // standard: 2+4
    if (length === 7) return 2; // na přání: 2+5
  }

  return null;
}
