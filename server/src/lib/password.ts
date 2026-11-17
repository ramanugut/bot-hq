import crypto from 'node:crypto';

/** Passwords are stored as scrypt hashes: "scrypt$<salt b64>$<hash b64>". */
export function hashPassword(pw: string): string {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(pw, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export function checkPassword(pw: string, stored: string | null | undefined): boolean {
  const [kind, salt, hash] = (stored ?? '').split('$');
  if (kind !== 'scrypt' || !salt || !hash) return false;
  const want = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(pw, Buffer.from(salt, 'base64'), want.length);
  return crypto.timingSafeEqual(got, want);
}

/** At most `max` failed tries per key in `windowMs`. */
const fails = new Map<string, number[]>();
export function tooManyTries(key: string, max = 10, windowMs = 15 * 60_000): boolean {
  const recent = (fails.get(key) ?? []).filter((t) => Date.now() - t < windowMs);
  fails.set(key, recent);
  return recent.length >= max;
}
export function noteFailure(key: string) {
  fails.set(key, [...(fails.get(key) ?? []), Date.now()]);
}
