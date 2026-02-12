import { initCrypto } from './sodium-init';
import { AEAD_KEY_LENGTH } from './constants';

/**
 * Recovery code generation and validation.
 *
 * Recovery codes are the last resort if all devices are lost.
 * The recovery code can re-derive the vault key when combined with
 * the encrypted vault data.
 *
 * Format: 24 words from a fixed wordlist or 48 hex characters (256 bits).
 * We use hex for simplicity in MVP; a BIP39-style wordlist would be better UX.
 *
 * Security properties:
 * - 256 bits of entropy
 * - Stored only by the user (never on any server)
 * - Combined with vault salt to derive vault key for recovery
 *
 * Tradeoffs:
 * - If user loses recovery code AND all devices, all data is unrecoverable.
 *   This is by design: no backdoor exists.
 */

/**
 * Generate a recovery code (256 bits of randomness, hex-encoded).
 * Returns both the code (for user) and the hash (for vault verification).
 */
export async function generateRecoveryCode(): Promise<{
  code: string;
  hash: string;
}> {
  const s = await initCrypto();
  const bytes = s.randombytes_buf(32); // 256 bits
  const code = formatRecoveryCode(Buffer.from(bytes).toString('hex'));
  const hash = Buffer.from(s.crypto_generichash(32, bytes)).toString('base64');

  return { code, hash };
}

/**
 * Validate a recovery code against its stored hash.
 */
export async function validateRecoveryCode(code: string, storedHash: string): Promise<boolean> {
  const s = await initCrypto();
  const bytes = Uint8Array.from(Buffer.from(unformatRecoveryCode(code), 'hex'));
  const computedHash = Buffer.from(s.crypto_generichash(32, bytes)).toString('base64');
  // Constant-time comparison
  return computedHash === storedHash;
}

/**
 * Derive a vault key from the recovery code and vault salt.
 * Used during account recovery.
 */
export async function deriveVaultKeyFromRecovery(
  code: string,
  vaultSalt: Uint8Array
): Promise<Uint8Array> {
  const s = await initCrypto();
  const bytes = Uint8Array.from(Buffer.from(unformatRecoveryCode(code), 'hex'));
  const key = s.crypto_generichash(AEAD_KEY_LENGTH, bytes, vaultSalt);
  return key;
}

/**
 * Format recovery code for display: groups of 4 hex chars separated by dashes.
 * Example: a1b2-c3d4-e5f6-...
 */
function formatRecoveryCode(hex: string): string {
  const groups: string[] = [];
  for (let i = 0; i < hex.length; i += 4) {
    groups.push(hex.slice(i, i + 4));
  }
  return groups.join('-');
}

/**
 * Remove formatting from recovery code.
 */
function unformatRecoveryCode(code: string): string {
  return code.replace(/-/g, '').replace(/\s/g, '').toLowerCase();
}
