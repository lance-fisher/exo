import * as openpgp from 'openpgp';
import { ATTESTATION_VERSION } from './constants';

export interface PGPIdentityInfo {
  fingerprint: string;
  userIds: string[];
  keyId: string;
  creationTime: Date;
  algorithmInfo: string;
}

export interface AttestationStatement {
  version: number;
  pgpFingerprint: string;
  messagingIdentityPublicKey: string; // base64
  deviceId: string;
  timestamp: number;
  pgpSignature: string; // base64 armored detached signature
}

export interface DeviceRevocation {
  version: number;
  pgpFingerprint: string;
  revokedDeviceId: string;
  timestamp: number;
  pgpSignature: string;
}

/**
 * PGP Identity management.
 *
 * PGP is used ONLY as an identity anchor:
 * - Parse and validate imported PGP private keys
 * - Extract fingerprint for identity
 * - Sign attestation statements binding messaging keys to PGP identity
 * - Sign device authorization and revocation statements
 *
 * PGP is NOT used for message encryption.
 */
export class PGPIdentity {
  private privateKey: openpgp.PrivateKey | null = null;
  private publicKey: openpgp.PublicKey | null = null;

  /**
   * Import an ASCII-armored PGP private key.
   * The key may be passphrase-protected; if so, provide the passphrase.
   */
  async importPrivateKey(armoredKey: string, passphrase?: string): Promise<PGPIdentityInfo> {
    const privateKey = await openpgp.readPrivateKey({ armoredKey });

    if (!privateKey.isDecrypted()) {
      if (!passphrase) {
        throw new Error('PGP key is passphrase-protected. Please provide the passphrase.');
      }
      this.privateKey = await openpgp.decryptKey({
        privateKey,
        passphrase,
      });
    } else {
      this.privateKey = privateKey;
    }

    this.publicKey = this.privateKey.toPublic();

    return this.getIdentityInfo();
  }

  /**
   * Import from an already-decrypted private key object (used when loading from vault).
   */
  async importFromDecrypted(armoredKey: string): Promise<PGPIdentityInfo> {
    this.privateKey = await openpgp.readPrivateKey({ armoredKey });
    this.publicKey = this.privateKey.toPublic();
    return this.getIdentityInfo();
  }

  /**
   * Get identity info from the loaded key.
   */
  getIdentityInfo(): PGPIdentityInfo {
    if (!this.publicKey) {
      throw new Error('No PGP key loaded');
    }

    const fingerprint = this.publicKey.getFingerprint();
    const userIds = this.publicKey.getUserIDs();
    const keyId = this.publicKey.getKeyID().toHex();
    const creationTime = this.publicKey.getCreationTime();
    const algo = this.publicKey.getAlgorithmInfo();

    return {
      fingerprint,
      userIds,
      keyId,
      creationTime,
      algorithmInfo: `${algo.algorithm}`,
    };
  }

  /**
   * Get the ASCII-armored public key.
   */
  getArmoredPublicKey(): string {
    if (!this.publicKey) {
      throw new Error('No PGP key loaded');
    }
    return this.publicKey.armor();
  }

  /**
   * Get the ASCII-armored private key (for encrypted vault storage only).
   */
  getArmoredPrivateKey(): string {
    if (!this.privateKey) {
      throw new Error('No PGP private key loaded');
    }
    return this.privateKey.armor();
  }

  /**
   * Sign an attestation binding a messaging identity public key to this PGP identity and device.
   */
  async signAttestation(
    messagingIdentityPublicKey: Uint8Array,
    deviceId: string
  ): Promise<AttestationStatement> {
    if (!this.privateKey || !this.publicKey) {
      throw new Error('No PGP key loaded');
    }

    const fingerprint = this.publicKey.getFingerprint();
    const timestamp = Date.now();
    const pubKeyBase64 = Buffer.from(messagingIdentityPublicKey).toString('base64');

    // Create canonical attestation payload
    const payload = this.buildAttestationPayload(fingerprint, pubKeyBase64, deviceId, timestamp);

    const message = await openpgp.createMessage({ text: payload });
    const signature = await openpgp.sign({
      message,
      signingKeys: this.privateKey,
      detached: true,
    });

    return {
      version: ATTESTATION_VERSION,
      pgpFingerprint: fingerprint,
      messagingIdentityPublicKey: pubKeyBase64,
      deviceId,
      timestamp,
      pgpSignature: typeof signature === 'string' ? signature : signature.toString(),
    };
  }

  /**
   * Verify an attestation statement against a PGP public key.
   */
  static async verifyAttestation(
    attestation: AttestationStatement,
    armoredPublicKey: string
  ): Promise<boolean> {
    const publicKey = await openpgp.readKey({ armoredKey: armoredPublicKey });
    const fingerprint = publicKey.getFingerprint();

    if (fingerprint !== attestation.pgpFingerprint) {
      return false;
    }

    const payload = PGPIdentity.prototype.buildAttestationPayload(
      attestation.pgpFingerprint,
      attestation.messagingIdentityPublicKey,
      attestation.deviceId,
      attestation.timestamp
    );

    const message = await openpgp.createMessage({ text: payload });
    const signature = await openpgp.readSignature({
      armoredSignature: attestation.pgpSignature,
    });

    const verificationResult = await openpgp.verify({
      message,
      signature,
      verificationKeys: publicKey,
    });

    const { verified } = verificationResult.signatures[0];
    try {
      await verified;
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Sign a device revocation statement.
   */
  async signDeviceRevocation(revokedDeviceId: string): Promise<DeviceRevocation> {
    if (!this.privateKey || !this.publicKey) {
      throw new Error('No PGP key loaded');
    }

    const fingerprint = this.publicKey.getFingerprint();
    const timestamp = Date.now();

    const payload = JSON.stringify({
      action: 'device-revocation',
      version: ATTESTATION_VERSION,
      pgpFingerprint: fingerprint,
      revokedDeviceId,
      timestamp,
    });

    const message = await openpgp.createMessage({ text: payload });
    const signature = await openpgp.sign({
      message,
      signingKeys: this.privateKey,
      detached: true,
    });

    return {
      version: ATTESTATION_VERSION,
      pgpFingerprint: fingerprint,
      revokedDeviceId,
      timestamp,
      pgpSignature: typeof signature === 'string' ? signature : signature.toString(),
    };
  }

  /**
   * Build canonical attestation payload string for signing/verification.
   */
  private buildAttestationPayload(
    fingerprint: string,
    pubKeyBase64: string,
    deviceId: string,
    timestamp: number
  ): string {
    return JSON.stringify({
      action: 'identity-attestation',
      version: ATTESTATION_VERSION,
      pgpFingerprint: fingerprint,
      messagingIdentityPublicKey: pubKeyBase64,
      deviceId,
      timestamp,
    });
  }

  /**
   * Clear all key material from memory.
   */
  destroy(): void {
    this.privateKey = null;
    this.publicKey = null;
  }
}
