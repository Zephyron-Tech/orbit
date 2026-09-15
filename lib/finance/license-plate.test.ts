import { describe, expect, it } from 'vitest';

import { formatLicensePlate } from './license-plate';

describe('formatLicensePlate', () => {
  it('groups a standard-issue car plate 3+4', () => {
    expect(formatLicensePlate('7C73505', 'CAR')).toBe('7C7 3505');
  });

  it('groups a "na přání" car plate 3+5', () => {
    expect(formatLicensePlate('7C712345', 'CAR')).toBe('7C7 12345');
  });

  it('groups a standard-issue motorcycle plate 2+4', () => {
    expect(formatLicensePlate('9C3342', 'MOTORCYCLE')).toBe('9C 3342');
  });

  it('groups a "na přání" motorcycle plate 2+5, disambiguated by vehicle type at the same length a car uses 3+4', () => {
    expect(formatLicensePlate('9C12345', 'MOTORCYCLE')).toBe('9C 12345');
    expect(formatLicensePlate('7C73505', 'CAR')).toBe('7C7 3505');
  });

  it('matches a real standard-issue motorcycle plate', () => {
    expect(formatLicensePlate('1CC990', 'MOTORCYCLE')).toBe('1C C990');
  });

  it('leaves an unrecognized length/category combination unformatted', () => {
    expect(formatLicensePlate('12345', 'CAR')).toBe('12345');
    expect(formatLicensePlate('ABC1234', 'TRUCK_OR_TRACTOR')).toBe('ABC1234');
  });

  it('normalizes case and whitespace before grouping', () => {
    expect(formatLicensePlate(' 7c7 3505 ', 'CAR')).toBe('7C7 3505');
  });

  it('passes an empty plate through unchanged', () => {
    expect(formatLicensePlate('', 'CAR')).toBe('');
  });
});
