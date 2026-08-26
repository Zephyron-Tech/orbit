import { describe, expect, it } from 'vitest';

import { decodeCsv, hasUtf8Bom } from './decode';

const bom = Uint8Array.from([0xef, 0xbb, 0xbf]);

function concat(...parts: Uint8Array[]): Uint8Array {
  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;

  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }

  return out;
}

describe('decodeCsv', () => {
  it('strips the UTF-8 BOM so the first header matches', () => {
    const bytes = concat(bom, new TextEncoder().encode('"Číslo účtu";"IBAN"'));
    const { text, encoding } = decodeCsv(bytes);

    expect(encoding).toBe('utf-8');
    expect(text.startsWith('"Číslo účtu"')).toBe(true);
    expect(text.charCodeAt(0)).not.toBe(0xfeff);
  });

  it('decodes plain UTF-8 without a BOM', () => {
    const { text, encoding } = decodeCsv(new TextEncoder().encode('Příkaz k úhradě'));

    expect(encoding).toBe('utf-8');
    expect(text).toBe('Příkaz k úhradě');
  });

  it('falls back to Windows-1250 for legacy exports', () => {
    // "Příkaz" in CP1250: P ř í k a z
    const bytes = Uint8Array.from([0x50, 0xf8, 0xed, 0x6b, 0x61, 0x7a]);
    const { text, encoding } = decodeCsv(bytes);

    expect(encoding).toBe('windows-1250');
    expect(text).toBe('Příkaz');
  });

  it('detects a BOM', () => {
    expect(hasUtf8Bom(bom)).toBe(true);
    expect(hasUtf8Bom(new TextEncoder().encode('abc'))).toBe(false);
  });
});
