import { randomBytes, scrypt as scryptCallback, timingSafeEqual, type ScryptOptions } from 'node:crypto';

/** promisify() cannot express the options overload of scrypt, so wrap it here. */
function scrypt(password: string, salt: Buffer, keyLength: number, options: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCallback(password, salt, keyLength, options, (error, derivedKey) => {
      if (error) {
        reject(error);
      } else {
        resolve(derivedKey);
      }
    });
  });
}

// OWASP-recommended scrypt parameters. Encoded into every hash so the cost can
// be raised later without invalidating existing passwords.
const COST = 2 ** 16;
const BLOCK_SIZE = 8;
const PARALLELIZATION = 1;
const KEY_LENGTH = 64;
const SALT_LENGTH = 16;

const MIN_PASSWORD_LENGTH = 10;

/** Format: scrypt$N$r$p$<salt-base64>$<hash-base64> */
const HASH_PATTERN = /^scrypt\$(\d+)\$(\d+)\$(\d+)\$([A-Za-z0-9+/=]+)\$([A-Za-z0-9+/=]+)$/;

export class WeakPasswordError extends Error {
  constructor() {
    super(`Password must be at least ${MIN_PASSWORD_LENGTH} characters long`);
    this.name = 'WeakPasswordError';
  }
}

async function derive(
  password: string,
  salt: Buffer,
  cost: number,
  blockSize: number,
  parallelization: number,
): Promise<Buffer> {
  // The default maxmem is too small for N = 2^16 and throws without it.
  return scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, {
    N: cost,
    r: blockSize,
    p: parallelization,
    maxmem: 256 * cost * blockSize,
  });
}

export async function hashPassword(password: string): Promise<string> {
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPasswordError();
  }

  const salt = randomBytes(SALT_LENGTH);
  const hash = await derive(password, salt, COST, BLOCK_SIZE, PARALLELIZATION);

  return [
    'scrypt',
    COST,
    BLOCK_SIZE,
    PARALLELIZATION,
    salt.toString('base64'),
    hash.toString('base64'),
  ].join('$');
}

/**
 * Constant-time verification. Returns false on a malformed stored hash instead
 * of throwing, so a corrupted row cannot be told apart from a wrong password.
 */
export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const match = HASH_PATTERN.exec(storedHash);

  if (!match) {
    return false;
  }

  const [, cost, blockSize, parallelization, saltBase64, hashBase64] = match;

  if (!cost || !blockSize || !parallelization || !saltBase64 || !hashBase64) {
    return false;
  }

  const expected = Buffer.from(hashBase64, 'base64');

  try {
    const actual = await derive(
      password,
      Buffer.from(saltBase64, 'base64'),
      Number(cost),
      Number(blockSize),
      Number(parallelization),
    );

    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

export { MIN_PASSWORD_LENGTH };
