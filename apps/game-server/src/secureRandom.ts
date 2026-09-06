import { randomBytes } from "node:crypto";

const UNIT_INTERVAL_DENOMINATOR = 2 ** 53;

/**
 * Uniform 53-bit fraction backed by the operating system CSPRNG. The reducer remains responsible
 * for preserving source draw order and for committing every consumed value before disclosure.
 */
export function secureUnitRandom(): number {
  const randomWord = randomBytes(8).readBigUInt64BE();
  return Number(randomWord >> 11n) / UNIT_INTERVAL_DENOMINATOR;
}
