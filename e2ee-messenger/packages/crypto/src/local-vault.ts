import sodium from 'libsodium-wrappers-sumo';
import { initCrypto } from './sodium-init';
import { AEAD_KEY_LENGTH, AEAD_NONCE_LENGTH, VAULT_KEY_INFO } from './constants';

export interface VaultData {
  pgpPrivateKeyArmored: string;
  identityKeyPair: {
    publicKey: string; // base64
    privateKey: string; // base64
  };
  keyBundleExport: string; // JSON stringified key bundle
  ratchetSessions: Record<string, string>; // contactId -> JSON stringified ratchet state
  deviceId: string;
  recoveryCodeHash: string;
  createdAt: number;
  version: number;
}

interface EncryptedVault {
  nonce: string; // base64
  salt: string; // base64
  ciphertext: string; // base64
  version: number;
}

/**
 * Local encrypted vault for storing all sensitive key material.
 *
 * The vault is encrypted using a key derived from WebAuthn assertion.
 * The flow:
 * 1. During setup: generate a random vault key, encrypt it with a key derived
 *    from the WebAuthn credential, store the encrypted vault key.
 * 2. On unlock: WebAuthn assertion -> derive wrapping key -> unwrap vault key -> decrypt vault.
 *
 * For environments where WebAuthn cannot export key material directly,
 * we use a challenge-response approach:
 * - Store a random "vault salt" in the clear
 * - The vault key = BLAKE2b(webauthn_assertion_signature || vault_salt)
 * - This means vault access requires both the WebAuthn credential and the salt
 *
 * In practice, the web app stores:
 * - encrypted_vault: AEAD-encrypted blob
 * - vault_salt: random bytes (cleartext)
 * - webauthn_credential_id: for re-authentication
 */
export class LocalVault {
  private vaultKey: Uint8Array | null = null;

  /**
   * Generate a new random vault key. Called during initial setup.
   */
  async generateVaultKey(): Promise<Uint8Array> {
    const s = await initCrypto();
    this.vaultKey = s.randombytes_buf(AEAD_KEY_LENGTH);
    return this.vaultKey;
  }

  /**
   * Derive a vault key from a WebAuthn assertion signature and vault salt.
   * This is the standard unlock path.
   */
  async deriveVaultKey(assertionSignature: Uint8Array, vaultSalt: Uint8Array): Promise<void> {
    const s = await initCrypto();
    const info = new TextEncoder().encode(VAULT_KEY_INFO);
    const input = new Uint8Array([...assertionSignature, ...info]);
    this.vaultKey = s.crypto_generichash(AEAD_KEY_LENGTH, input, vaultSalt);
    input.fill(0);
  }

  /**
   * Derive a wrapping key for encrypting the vault key itself.
   * Used during initial setup to wrap the vault key with WebAuthn-derived material.
   */
  async deriveWrappingKey(
    assertionSignature: Uint8Array,
    salt: Uint8Array
  ): Promise<Uint8Array> {
    const s = await initCrypto();
    const info = new TextEncoder().encode(VAULT_KEY_INFO + '-wrap');
    const input = new Uint8Array([...assertionSignature, ...info]);
    const key = s.crypto_generichash(AEAD_KEY_LENGTH, input, salt);
    input.fill(0);
    return key;
  }

  /**
   * Wrap (encrypt) the vault key for storage. The wrapping key comes from WebAuthn.
   */
  async wrapVaultKey(wrappingKey: Uint8Array): Promise<{ nonce: string; ciphertext: string }> {
    const s = await initCrypto();
    if (!this.vaultKey) throw new Error('No vault key to wrap');

    const nonce = s.randombytes_buf(AEAD_NONCE_LENGTH);
    const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
      this.vaultKey,
      null,
      null,
      nonce,
      wrappingKey
    );

    return {
      nonce: Buffer.from(nonce).toString('base64'),
      ciphertext: Buffer.from(ciphertext).toString('base64'),
    };
  }

  /**
   * Unwrap (decrypt) the vault key using the wrapping key from WebAuthn.
   */
  async unwrapVaultKey(
    wrappingKey: Uint8Array,
    wrappedKey: { nonce: string; ciphertext: string }
  ): Promise<void> {
    const s = await initCrypto();
    const nonce = Uint8Array.from(Buffer.from(wrappedKey.nonce, 'base64'));
    const ciphertext = Uint8Array.from(Buffer.from(wrappedKey.ciphertext, 'base64'));

    this.vaultKey = s.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      null,
      nonce,
      wrappingKey
    );
  }

  /**
   * Set vault key directly (for recovery scenarios).
   */
  setVaultKey(key: Uint8Array): void {
    this.vaultKey = key;
  }

  /**
   * Encrypt vault data for local storage.
   */
  async encrypt(data: VaultData): Promise<string> {
    const s = await initCrypto();
    if (!this.vaultKey) throw new Error('Vault is locked');

    const plaintext = new TextEncoder().encode(JSON.stringify(data));
    const nonce = s.randombytes_buf(AEAD_NONCE_LENGTH);
    const salt = s.randombytes_buf(32);

    // Derive a per-encryption key from vault key + salt
    const encKey = s.crypto_generichash(AEAD_KEY_LENGTH, salt, this.vaultKey);

    const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      salt, // use salt as additional data for binding
      null,
      nonce,
      encKey
    );

    encKey.fill(0);
    plaintext.fill(0);

    const vault: EncryptedVault = {
      nonce: Buffer.from(nonce).toString('base64'),
      salt: Buffer.from(salt).toString('base64'),
      ciphertext: Buffer.from(ciphertext).toString('base64'),
      version: 1,
    };

    return JSON.stringify(vault);
  }

  /**
   * Decrypt vault data from local storage.
   */
  async decrypt(encryptedJson: string): Promise<VaultData> {
    const s = await initCrypto();
    if (!this.vaultKey) throw new Error('Vault is locked');

    const vault: EncryptedVault = JSON.parse(encryptedJson);
    const nonce = Uint8Array.from(Buffer.from(vault.nonce, 'base64'));
    const salt = Uint8Array.from(Buffer.from(vault.salt, 'base64'));
    const ciphertext = Uint8Array.from(Buffer.from(vault.ciphertext, 'base64'));

    const encKey = s.crypto_generichash(AEAD_KEY_LENGTH, salt, this.vaultKey);

    const plaintext = s.crypto_aead_xchacha20poly1305_ietf_decrypt(
      null,
      ciphertext,
      salt,
      nonce,
      encKey
    );

    encKey.fill(0);

    const data: VaultData = JSON.parse(new TextDecoder().decode(plaintext));
    return data;
  }

  /**
   * Check if vault is unlocked.
   */
  isUnlocked(): boolean {
    return this.vaultKey !== null;
  }

  /**
   * Lock the vault, clearing the vault key from memory.
   */
  lock(): void {
    if (this.vaultKey) {
      this.vaultKey.fill(0);
      this.vaultKey = null;
    }
  }

  /**
   * Securely wipe all vault data from storage.
   */
  static wipeStorage(): void {
    if (typeof localStorage !== 'undefined') {
      localStorage.removeItem('e2ee_vault');
      localStorage.removeItem('e2ee_vault_salt');
      localStorage.removeItem('e2ee_wrapped_key');
      localStorage.removeItem('e2ee_credential_id');
    }
    if (typeof indexedDB !== 'undefined') {
      indexedDB.deleteDatabase('e2ee-messenger');
    }
  }
}
