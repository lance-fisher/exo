import sodium from 'libsodium-wrappers-sumo';
import { initCrypto } from './sodium-init';

/**
 * HKDF-BLAKE2b: A proper HKDF (RFC 5869) implementation using BLAKE2b
 * instead of HMAC-SHA256.
 *
 * HKDF has two phases:
 *   Extract: PRK = BLAKE2b(key=salt, message=IKM)
 *   Expand:  OKM = T(1) || T(2) || ... truncated to desired length
 *     where T(i) = BLAKE2b(key=PRK, message=T(i-1) || info || i)
 *           T(0) = empty
 *
 * Note on BLAKE2b vs HMAC: BLAKE2b natively supports a key parameter,
 * making it suitable as a direct PRF replacement for HMAC in HKDF.
 * The security argument is the same: extract produces a uniformly random
 * PRK, and expand produces cryptographically independent output blocks.
 *
 * References:
 * - RFC 5869 (HKDF)
 * - Signal X3DH specification
 * - Signal Double Ratchet specification
 */

/**
 * HKDF-Extract: Derive a pseudorandom key from input keying material.
 *
 * PRK = BLAKE2b(key=salt, message=ikm)
 *
 * @param s Initialized libsodium instance
 * @param salt Optional salt (if empty/null, uses a zero-filled key of 64 bytes)
 * @param ikm Input keying material
 * @returns 64-byte pseudorandom key
 */
export function hkdfExtract(
  s: typeof sodium,
  salt: Uint8Array | null,
  ikm: Uint8Array
): Uint8Array {
  // BLAKE2b with key: crypto_generichash(outlen, message, key)
  // salt is the key, ikm is the message — matching HMAC(salt, ikm)
  const effectiveSalt = salt && salt.length > 0
    ? salt
    : new Uint8Array(64); // all-zero salt per RFC 5869 §2.2
  return s.crypto_generichash(64, ikm, effectiveSalt);
}

/**
 * HKDF-Expand: Expand a PRK into output keying material of desired length.
 *
 * T(0) = empty
 * T(i) = BLAKE2b(key=PRK, message=T(i-1) || info || i)
 * OKM  = first `length` bytes of T(1) || T(2) || ...
 *
 * @param s Initialized libsodium instance
 * @param prk Pseudorandom key (from Extract phase)
 * @param info Context/application-specific info string
 * @param length Desired output length in bytes (max 255 * 64 = 16320)
 * @returns Output keying material of the requested length
 */
export function hkdfExpand(
  s: typeof sodium,
  prk: Uint8Array,
  info: Uint8Array,
  length: number
): Uint8Array {
  const hashLen = 64; // BLAKE2b output length
  const n = Math.ceil(length / hashLen);
  if (n > 255) {
    throw new Error('HKDF-Expand: requested length too large');
  }

  const okm = new Uint8Array(n * hashLen);
  let prevT = new Uint8Array(0); // T(0) = empty

  for (let i = 1; i <= n; i++) {
    // T(i) = BLAKE2b(key=PRK, message=T(i-1) || info || i)
    const input = new Uint8Array(prevT.length + info.length + 1);
    input.set(prevT, 0);
    input.set(info, prevT.length);
    input[prevT.length + info.length] = i;

    const t = s.crypto_generichash(hashLen, input, prk);
    okm.set(t, (i - 1) * hashLen);
    prevT = t;
  }

  // Truncate to desired length
  return okm.slice(0, length);
}

/**
 * Full HKDF: Extract-then-Expand in one call.
 *
 * @param s Initialized libsodium instance
 * @param ikm Input keying material
 * @param salt Optional salt for Extract phase
 * @param info Context string for Expand phase
 * @param length Desired output length in bytes
 * @returns Output keying material
 */
export function hkdf(
  s: typeof sodium,
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array,
  length: number
): Uint8Array {
  const prk = hkdfExtract(s, salt, ikm);
  const okm = hkdfExpand(s, prk, info, length);
  prk.fill(0);
  return okm;
}

/**
 * Convenience wrapper that initializes sodium and performs HKDF.
 */
export async function hkdfAsync(
  ikm: Uint8Array,
  salt: Uint8Array | null,
  info: Uint8Array,
  length: number
): Promise<Uint8Array> {
  const s = await initCrypto();
  return hkdf(s, ikm, salt, info, length);
}
