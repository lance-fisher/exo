import sodium from 'libsodium-wrappers-sumo';
import { initCrypto } from './sodium-init';
import { MAX_PREKEYS } from './constants';

export interface SignedPreKey {
  keyId: number;
  publicKey: Uint8Array;
  signature: Uint8Array; // Ed25519 signature by identity key
  timestamp: number;
}

export interface OneTimePreKey {
  keyId: number;
  publicKey: Uint8Array;
}

export interface PreKeyBundle {
  identityPublicKey: Uint8Array; // Ed25519
  signedPreKey: SignedPreKey;
  oneTimePreKey?: OneTimePreKey; // may be exhausted
}

interface KeyPairRecord {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Key bundle management for X3DH-style key agreement.
 *
 * Each device maintains:
 * - Identity key pair (Ed25519, long-term, signed by PGP)
 * - Signed pre-key pair (X25519, medium-term, rotated periodically)
 * - One-time pre-keys (X25519, single-use)
 *
 * The identity key pair is Ed25519 for signing. For X3DH DH operations,
 * it is converted to X25519 (Curve25519).
 */
export class KeyBundle {
  private identityKeyPair: KeyPairRecord | null = null;
  private signedPreKeyPair: KeyPairRecord | null = null;
  private signedPreKeyRecord: SignedPreKey | null = null;
  private oneTimePreKeys: Map<number, KeyPairRecord> = new Map();
  private nextPreKeyId = 0;
  private nextSignedPreKeyId = 0;

  /**
   * Generate a new identity key pair (Ed25519).
   * This is the long-term messaging identity key, distinct from PGP.
   */
  async generateIdentityKeyPair(): Promise<Uint8Array> {
    const s = await initCrypto();
    const kp = s.crypto_sign_keypair();
    this.identityKeyPair = {
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    };
    return kp.publicKey;
  }

  /**
   * Import an existing identity key pair (from encrypted vault).
   */
  importIdentityKeyPair(publicKey: Uint8Array, privateKey: Uint8Array): void {
    this.identityKeyPair = { publicKey, privateKey };
  }

  /**
   * Get the identity public key (Ed25519).
   */
  getIdentityPublicKey(): Uint8Array {
    if (!this.identityKeyPair) throw new Error('No identity key pair');
    return this.identityKeyPair.publicKey;
  }

  /**
   * Get the identity private key (Ed25519) - for vault storage only.
   */
  getIdentityPrivateKey(): Uint8Array {
    if (!this.identityKeyPair) throw new Error('No identity key pair');
    return this.identityKeyPair.privateKey;
  }

  /**
   * Convert identity Ed25519 key pair to X25519 for DH operations.
   */
  async getIdentityX25519KeyPair(): Promise<KeyPairRecord> {
    const s = await initCrypto();
    if (!this.identityKeyPair) throw new Error('No identity key pair');
    return {
      publicKey: s.crypto_sign_ed25519_pk_to_curve25519(this.identityKeyPair.publicKey),
      privateKey: s.crypto_sign_ed25519_sk_to_curve25519(this.identityKeyPair.privateKey),
    };
  }

  /**
   * Generate a new signed pre-key. The pre-key is X25519, signed by the Ed25519 identity key.
   */
  async generateSignedPreKey(): Promise<SignedPreKey> {
    const s = await initCrypto();
    if (!this.identityKeyPair) throw new Error('No identity key pair');

    const kp = s.crypto_box_keypair();
    this.signedPreKeyPair = {
      publicKey: kp.publicKey,
      privateKey: kp.privateKey,
    };

    const keyId = this.nextSignedPreKeyId++;
    const timestamp = Date.now();

    // Sign the pre-key public key with the identity key
    const dataToSign = new Uint8Array([
      ...kp.publicKey,
      ...new TextEncoder().encode(`${keyId}:${timestamp}`),
    ]);
    const signature = s.crypto_sign_detached(dataToSign, this.identityKeyPair.privateKey);

    this.signedPreKeyRecord = {
      keyId,
      publicKey: kp.publicKey,
      signature,
      timestamp,
    };

    return this.signedPreKeyRecord;
  }

  /**
   * Get the signed pre-key private key for DH.
   */
  getSignedPreKeyPrivate(): Uint8Array {
    if (!this.signedPreKeyPair) throw new Error('No signed pre-key');
    return this.signedPreKeyPair.privateKey;
  }

  /**
   * Generate a batch of one-time pre-keys (X25519).
   */
  async generateOneTimePreKeys(count: number = MAX_PREKEYS): Promise<OneTimePreKey[]> {
    const s = await initCrypto();
    const keys: OneTimePreKey[] = [];

    for (let i = 0; i < count; i++) {
      const kp = s.crypto_box_keypair();
      const keyId = this.nextPreKeyId++;
      this.oneTimePreKeys.set(keyId, {
        publicKey: kp.publicKey,
        privateKey: kp.privateKey,
      });
      keys.push({ keyId, publicKey: kp.publicKey });
    }

    return keys;
  }

  /**
   * Consume a one-time pre-key (remove after use in X3DH).
   */
  consumeOneTimePreKey(keyId: number): Uint8Array {
    const kp = this.oneTimePreKeys.get(keyId);
    if (!kp) throw new Error(`One-time pre-key ${keyId} not found or already consumed`);
    this.oneTimePreKeys.delete(keyId);
    return kp.privateKey;
  }

  /**
   * Get a pre-key bundle for publishing to the rendezvous server.
   */
  getPublicPreKeyBundle(): PreKeyBundle {
    if (!this.identityKeyPair) throw new Error('No identity key pair');
    if (!this.signedPreKeyRecord) throw new Error('No signed pre-key');

    const bundle: PreKeyBundle = {
      identityPublicKey: this.identityKeyPair.publicKey,
      signedPreKey: this.signedPreKeyRecord,
    };

    // Include one one-time prekey if available
    if (this.oneTimePreKeys.size > 0) {
      const firstEntry = this.oneTimePreKeys.entries().next().value;
      if (firstEntry) {
        const [keyId, kp] = firstEntry;
        bundle.oneTimePreKey = { keyId, publicKey: kp.publicKey };
      }
    }

    return bundle;
  }

  /**
   * Verify a signed pre-key against an identity public key.
   */
  static async verifySignedPreKey(
    identityPublicKey: Uint8Array,
    signedPreKey: SignedPreKey
  ): Promise<boolean> {
    const s = await initCrypto();
    const dataToSign = new Uint8Array([
      ...signedPreKey.publicKey,
      ...new TextEncoder().encode(`${signedPreKey.keyId}:${signedPreKey.timestamp}`),
    ]);
    try {
      return s.crypto_sign_verify_detached(signedPreKey.signature, dataToSign, identityPublicKey);
    } catch {
      return false;
    }
  }

  /**
   * Export all key material for vault storage.
   */
  exportForVault(): {
    identityKeyPair: KeyPairRecord | null;
    signedPreKeyPair: KeyPairRecord | null;
    signedPreKeyRecord: SignedPreKey | null;
    oneTimePreKeys: Array<{ keyId: number; keyPair: KeyPairRecord }>;
    nextPreKeyId: number;
    nextSignedPreKeyId: number;
  } {
    return {
      identityKeyPair: this.identityKeyPair,
      signedPreKeyPair: this.signedPreKeyPair,
      signedPreKeyRecord: this.signedPreKeyRecord,
      oneTimePreKeys: Array.from(this.oneTimePreKeys.entries()).map(([keyId, keyPair]) => ({
        keyId,
        keyPair,
      })),
      nextPreKeyId: this.nextPreKeyId,
      nextSignedPreKeyId: this.nextSignedPreKeyId,
    };
  }

  /**
   * Import key material from vault.
   */
  importFromVault(data: ReturnType<KeyBundle['exportForVault']>): void {
    this.identityKeyPair = data.identityKeyPair;
    this.signedPreKeyPair = data.signedPreKeyPair;
    this.signedPreKeyRecord = data.signedPreKeyRecord;
    this.oneTimePreKeys = new Map(data.oneTimePreKeys.map(({ keyId, keyPair }) => [keyId, keyPair]));
    this.nextPreKeyId = data.nextPreKeyId;
    this.nextSignedPreKeyId = data.nextSignedPreKeyId;
  }

  /**
   * Securely clear all key material.
   */
  destroy(): void {
    // Zero out private keys before releasing references
    if (this.identityKeyPair?.privateKey) {
      this.identityKeyPair.privateKey.fill(0);
    }
    if (this.signedPreKeyPair?.privateKey) {
      this.signedPreKeyPair.privateKey.fill(0);
    }
    for (const kp of this.oneTimePreKeys.values()) {
      kp.privateKey.fill(0);
    }
    this.identityKeyPair = null;
    this.signedPreKeyPair = null;
    this.signedPreKeyRecord = null;
    this.oneTimePreKeys.clear();
  }
}
