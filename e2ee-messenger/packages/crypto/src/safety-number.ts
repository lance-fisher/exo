import { initCrypto } from './sodium-init';

/**
 * Safety Number generation for contact verification.
 *
 * Similar to Signal's "Safety Number" concept:
 * - Derived from both parties' identity public keys
 * - Displayed as a numeric code for out-of-band verification
 * - Changes if either party's identity key changes (MITM detection)
 *
 * The safety number is computed as:
 *   BLAKE2b(sort(identity_key_A, identity_key_B))
 * formatted as blocks of 5 digits for readability.
 */
export class SafetyNumber {
  /**
   * Compute a safety number from two identity public keys.
   * The result is deterministic regardless of which key is "ours" vs "theirs".
   *
   * @returns A string of 12 groups of 5 digits (60 digits total)
   */
  static async compute(
    identityKeyA: Uint8Array,
    identityKeyB: Uint8Array
  ): Promise<string> {
    const s = await initCrypto();

    // Sort keys to ensure same result regardless of order
    const [first, second] = this.sortKeys(identityKeyA, identityKeyB);

    // Hash the concatenated sorted keys
    const input = new Uint8Array([...first, ...second]);
    const hash = s.crypto_generichash(30, input); // 30 bytes = 240 bits

    // Convert to decimal digits
    return this.formatDigits(hash);
  }

  /**
   * Compare safety numbers for display - returns blocks for easy visual comparison.
   */
  static async computeBlocks(
    identityKeyA: Uint8Array,
    identityKeyB: Uint8Array
  ): Promise<string[]> {
    const number = await this.compute(identityKeyA, identityKeyB);
    const blocks: string[] = [];
    for (let i = 0; i < number.length; i += 5) {
      blocks.push(number.slice(i, i + 5));
    }
    return blocks;
  }

  /**
   * Generate QR code data for contact verification.
   * Contains both identity keys and the safety number.
   */
  static async generateQRData(
    pgpFingerprint: string,
    identityPublicKey: Uint8Array,
    safetyNumber: string
  ): Promise<string> {
    return JSON.stringify({
      version: 1,
      type: 'e2ee-messenger-verify',
      pgpFingerprint,
      identityPublicKey: Buffer.from(identityPublicKey).toString('base64'),
      safetyNumber,
    });
  }

  /**
   * Sort two keys lexicographically for deterministic ordering.
   */
  private static sortKeys(a: Uint8Array, b: Uint8Array): [Uint8Array, Uint8Array] {
    for (let i = 0; i < Math.min(a.length, b.length); i++) {
      if (a[i] < b[i]) return [a, b];
      if (a[i] > b[i]) return [b, a];
    }
    return a.length <= b.length ? [a, b] : [b, a];
  }

  /**
   * Convert hash bytes to formatted digit groups.
   * Each 2 bytes (16 bits) produce 5 decimal digits (0-65535, zero-padded).
   */
  private static formatDigits(hash: Uint8Array): string {
    let digits = '';
    for (let i = 0; i < hash.length - 1; i += 2) {
      const value = (hash[i] << 8) | hash[i + 1];
      digits += value.toString().padStart(5, '0');
    }
    return digits;
  }
}
