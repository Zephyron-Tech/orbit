/** Czech count agreement: 1 → singular, 2-4 → "few" form, 0 or 5+ → "many" form. */
export function pluralizeCs(count: number, one: string, few: string, many: string): string {
  if (count === 1) return one;
  if (count >= 2 && count <= 4) return few;
  return many;
}
