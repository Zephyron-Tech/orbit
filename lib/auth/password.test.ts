import { describe, expect, it } from 'vitest';

import { hashPassword, verifyPassword, WeakPasswordError } from './password';

describe('password hashing', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct horse battery');

    await expect(verifyPassword('correct horse battery', hash)).resolves.toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct horse battery');

    await expect(verifyPassword('correct horse batteru', hash)).resolves.toBe(false);
  });

  it('produces a different hash for the same password', async () => {
    const [first, second] = await Promise.all([hashPassword('same password'), hashPassword('same password')]);

    expect(first).not.toBe(second);
  });

  it('normalizes unicode so an equivalent password still verifies', async () => {
    // U+00E9 versus e + U+0301: the same grapheme, different bytes.
    const hash = await hashPassword('héslo dlouhe');

    await expect(verifyPassword('héslo dlouhe', hash)).resolves.toBe(true);
  });

  it('rejects a short password', async () => {
    await expect(hashPassword('short')).rejects.toBeInstanceOf(WeakPasswordError);
  });

  it('returns false for a malformed stored hash instead of throwing', async () => {
    await expect(verifyPassword('whatever', 'not-a-hash')).resolves.toBe(false);
    await expect(verifyPassword('whatever', '')).resolves.toBe(false);
  });
});
