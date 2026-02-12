import sodium from 'libsodium-wrappers-sumo';
import { initCrypto } from './sodium-init';
import { X3DH_INFO } from './constants';
import { hkdf } from './hkdf';
import { type PreKeyBundle, KeyBundle } from './key-bundle';

export interface X3DHResult {
  sharedSecret: Uint8Array; // 32-byte shared secret for initializing Double Ratchet
  ephemeralPublicKey: Uint8Array; // Sender's ephemeral public key
  usedOneTimePreKeyId?: number; // ID of consumed one-time pre-key, if any
}

export interface X3DHInitialMessage {
  identityPublicKey: Uint8Array; // Sender's identity public key (Ed25519)
  ephemeralPublicKey: Uint8Array; // Sender's ephemeral X25519 key
  usedSignedPreKeyId: number;
  usedOneTimePreKeyId?: number;
  ciphertext: Uint8Array; // Initial ratchet message
}

/**
 * X3DH (Extended Triple Diffie-Hellman) key agreement protocol.
 *
 * This implements a Signal-protocol-style X3DH handshake:
 *
 * Initiator (Alice) has:
 *   - IK_A: Identity key pair (Ed25519, converted to X25519 for DH)
 *   - EK_A: Ephemeral key pair (X25519, freshly generated)
 *
 * Responder (Bob) publishes:
 *   - IK_B: Identity public key (Ed25519, converted to X25519)
 *   - SPK_B: Signed pre-key (X25519, signed by IK_B)
 *   - OPK_B: One-time pre-key (X25519, optional)
 *
 * Key agreement:
 *   DH1 = DH(IK_A, SPK_B)     -- Provides mutual authentication
 *   DH2 = DH(EK_A, IK_B)      -- Provides forward secrecy from initiator
 *   DH3 = DH(EK_A, SPK_B)     -- Provides forward secrecy
 *   DH4 = DH(EK_A, OPK_B)     -- One-time key for additional protection (optional)
 *
 *   SK = KDF(DH1 || DH2 || DH3 || DH4)
 *
 * Properties achieved:
 *   - Forward secrecy: compromising identity keys doesn't reveal past messages
 *   - Deniability: neither party can prove the other participated
 *   - Asynchronous: Bob doesn't need to be online
 */
export class X3DHHandshake {
  /**
   * Initiator side: compute shared secret using recipient's pre-key bundle.
   *
   * @param senderIdentityPrivateKey Ed25519 private key of sender
   * @param recipientBundle Pre-key bundle from rendezvous server
   * @returns Shared secret and ephemeral public key to send to recipient
   */
  static async initiatorAgree(
    senderIdentityKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array },
    recipientBundle: PreKeyBundle
  ): Promise<X3DHResult> {
    const s = await initCrypto();

    // Verify the signed pre-key
    const valid = await KeyBundle.verifySignedPreKey(
      recipientBundle.identityPublicKey,
      recipientBundle.signedPreKey
    );
    if (!valid) {
      throw new Error('Invalid signed pre-key signature');
    }

    // Convert Ed25519 identity keys to X25519 for DH
    const senderX25519Private = s.crypto_sign_ed25519_sk_to_curve25519(
      senderIdentityKeyPair.privateKey
    );
    const recipientX25519Public = s.crypto_sign_ed25519_pk_to_curve25519(
      recipientBundle.identityPublicKey
    );

    // Generate ephemeral X25519 key pair
    const ephemeral = s.crypto_box_keypair();

    // Perform DH operations
    // DH1: sender identity <-> recipient signed pre-key
    const dh1 = s.crypto_scalarmult(senderX25519Private, recipientBundle.signedPreKey.publicKey);

    // DH2: sender ephemeral <-> recipient identity
    const dh2 = s.crypto_scalarmult(ephemeral.privateKey, recipientX25519Public);

    // DH3: sender ephemeral <-> recipient signed pre-key
    const dh3 = s.crypto_scalarmult(ephemeral.privateKey, recipientBundle.signedPreKey.publicKey);

    // Concatenate DH results
    let dhConcat: Uint8Array;
    let usedOneTimePreKeyId: number | undefined;

    if (recipientBundle.oneTimePreKey) {
      // DH4: sender ephemeral <-> recipient one-time pre-key
      const dh4 = s.crypto_scalarmult(
        ephemeral.privateKey,
        recipientBundle.oneTimePreKey.publicKey
      );
      dhConcat = new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4]);
      usedOneTimePreKeyId = recipientBundle.oneTimePreKey.keyId;
    } else {
      dhConcat = new Uint8Array([...dh1, ...dh2, ...dh3]);
    }

    // Derive shared secret using HKDF
    const sharedSecret = this.kdf(s, dhConcat);

    // Zero out intermediate values
    dh1.fill(0);
    dh2.fill(0);
    dh3.fill(0);
    senderX25519Private.fill(0);
    ephemeral.privateKey.fill(0);
    dhConcat.fill(0);

    return {
      sharedSecret,
      ephemeralPublicKey: ephemeral.publicKey,
      usedOneTimePreKeyId,
    };
  }

  /**
   * Responder side: compute shared secret from an initial message.
   *
   * @param responderIdentityKeyPair Ed25519 identity key pair
   * @param signedPreKeyPrivate X25519 signed pre-key private key
   * @param initialMsg The X3DH initial message from initiator
   * @param oneTimePreKeyPrivate Optional one-time pre-key private key
   * @returns 32-byte shared secret
   */
  static async responderAgree(
    responderIdentityKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array },
    signedPreKeyPrivate: Uint8Array,
    senderIdentityPublicKey: Uint8Array,
    ephemeralPublicKey: Uint8Array,
    oneTimePreKeyPrivate?: Uint8Array
  ): Promise<Uint8Array> {
    const s = await initCrypto();

    // Convert Ed25519 keys to X25519
    const responderX25519Private = s.crypto_sign_ed25519_sk_to_curve25519(
      responderIdentityKeyPair.privateKey
    );
    const senderX25519Public = s.crypto_sign_ed25519_pk_to_curve25519(senderIdentityPublicKey);

    // Perform DH operations (mirroring initiator)
    // DH1: sender identity <-> responder signed pre-key
    const dh1 = s.crypto_scalarmult(signedPreKeyPrivate, senderX25519Public);

    // DH2: sender ephemeral <-> responder identity
    const dh2 = s.crypto_scalarmult(responderX25519Private, ephemeralPublicKey);

    // DH3: sender ephemeral <-> responder signed pre-key
    const dh3 = s.crypto_scalarmult(signedPreKeyPrivate, ephemeralPublicKey);

    let dhConcat: Uint8Array;
    if (oneTimePreKeyPrivate) {
      const dh4 = s.crypto_scalarmult(oneTimePreKeyPrivate, ephemeralPublicKey);
      dhConcat = new Uint8Array([...dh1, ...dh2, ...dh3, ...dh4]);
      dh4.fill(0);
    } else {
      dhConcat = new Uint8Array([...dh1, ...dh2, ...dh3]);
    }

    const sharedSecret = this.kdf(s, dhConcat);

    // Zero intermediates
    dh1.fill(0);
    dh2.fill(0);
    dh3.fill(0);
    responderX25519Private.fill(0);
    dhConcat.fill(0);

    return sharedSecret;
  }

  /**
   * KDF: HKDF-BLAKE2b to derive a 32-byte shared secret from DH output.
   *
   * Per Signal's X3DH spec §2.2:
   * - Prepend 32 bytes of 0xFF to avoid collisions with other protocol uses
   * - Use all-zero salt for the initial derivation
   * - Use application-specific info string for domain separation
   *
   * Uses proper HKDF (Extract-then-Expand) with BLAKE2b as the PRF.
   */
  private static kdf(s: typeof sodium, input: Uint8Array): Uint8Array {
    const prefix = new Uint8Array(32).fill(0xff);
    const ikm = new Uint8Array(prefix.length + input.length);
    ikm.set(prefix, 0);
    ikm.set(input, prefix.length);

    const info = new TextEncoder().encode(X3DH_INFO);
    const okm = hkdf(s, ikm, null, info, 32);

    ikm.fill(0);
    return okm;
  }
}
