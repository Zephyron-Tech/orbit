/**
 * Bank exports are not consistently encoded. Moneta currently ships UTF-8 with
 * a BOM, but the same institution has historically offered Windows-1250, and a
 * mis-decoded file silently turns every Czech name into mojibake instead of
 * failing. The BOM in particular must go: left in place it becomes part of the
 * first column name and the header no longer matches.
 */

const UTF8_BOM = [0xef, 0xbb, 0xbf];

/** Bytes that are never valid in a UTF-8 continuation, common in CP1250 text. */
function isValidUtf8(bytes: Uint8Array): boolean {
  try {
    new TextDecoder('utf-8', { fatal: true }).decode(bytes);

    return true;
  } catch {
    return false;
  }
}

export function hasUtf8Bom(bytes: Uint8Array): boolean {
  return UTF8_BOM.every((byte, index) => bytes[index] === byte);
}

export interface DecodedCsv {
  text: string;
  encoding: 'utf-8' | 'windows-1250';
}

/**
 * Decodes uploaded bytes to text, stripping a UTF-8 BOM when present and
 * falling back to Windows-1250 for files that are not valid UTF-8.
 */
export function decodeCsv(bytes: Uint8Array): DecodedCsv {
  const withoutBom = hasUtf8Bom(bytes) ? bytes.subarray(UTF8_BOM.length) : bytes;

  if (isValidUtf8(withoutBom)) {
    return { text: new TextDecoder('utf-8').decode(withoutBom), encoding: 'utf-8' };
  }

  return {
    text: new TextDecoder('windows-1250').decode(withoutBom),
    encoding: 'windows-1250',
  };
}
