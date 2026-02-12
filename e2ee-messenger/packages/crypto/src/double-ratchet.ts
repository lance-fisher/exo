import sodium from 'libsodium-wrappers-sumo';
import { initCrypto } from './sodium-init';
import {
  MAX_SKIP,
  AEAD_KEY_LENGTH,
  AEAD_NONCE_LENGTH,
  ROOT_KEY_INFO,
  CHAIN_KEY_INFO,
  MESSAGE_KEY_INFO,
} from './constants';

export interface EncryptedMessage {
  header: MessageHeader;
  ciphertext: Uint8Array; // XChaCha20-Poly1305 encrypted
  nonce: Uint8Array;
}

export interface MessageHeader {
  dhPublicKey: Uint8Array; // Current ratchet public key
  previousChainLength: number; // Number of messages in previous sending chain
  messageNumber: number; // Message number in current sending chain
}

export interface RatchetState {
  rootKey: Uint8Array;
  sendingChainKey: Uint8Array | null;
  receivingChainKey: Uint8Array | null;
  sendingRatchetKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array } | null;
  receivingRatchetPublicKey: Uint8Array | null;
  sendMessageNumber: number;
  receiveMessageNumber: number;
  previousSendingChainLength: number;
  skippedMessageKeys: Map<string, Uint8Array>; // "pubkey:msgNum" -> message key
}

/**
 * Double Ratchet Algorithm implementation.
 *
 * Provides:
 * - Forward secrecy: past message keys are deleted after use
 * - Post-compromise security: new DH ratchet steps heal from compromise
 * - Message ordering: handles out-of-order messages via skipped key storage
 * - Replay protection: each message key is used exactly once
 *
 * Uses XChaCha20-Poly1305 for AEAD encryption (authenticated encryption).
 *
 * References:
 * - Signal Double Ratchet specification
 * - https://signal.org/docs/specifications/doubleratchet/
 */
export class DoubleRatchet {
  private state: RatchetState;

  private constructor(state: RatchetState) {
    this.state = state;
  }

  /**
   * Initialize as the initiator (Alice) after X3DH.
   * Alice knows Bob's signed pre-key (used as initial ratchet public key).
   */
  static async initInitiator(
    sharedSecret: Uint8Array,
    recipientRatchetPublicKey: Uint8Array
  ): Promise<DoubleRatchet> {
    const s = await initCrypto();

    // Generate initial sending ratchet key pair
    const sendingKeyPair = s.crypto_box_keypair();

    // Perform initial DH ratchet step
    const dhOutput = s.crypto_scalarmult(sendingKeyPair.privateKey, recipientRatchetPublicKey);

    // Derive root key and sending chain key
    const [rootKey, sendingChainKey] = await DoubleRatchet.kdfRK(s, sharedSecret, dhOutput);

    dhOutput.fill(0);

    return new DoubleRatchet({
      rootKey,
      sendingChainKey,
      receivingChainKey: null,
      sendingRatchetKeyPair: sendingKeyPair,
      receivingRatchetPublicKey: recipientRatchetPublicKey,
      sendMessageNumber: 0,
      receiveMessageNumber: 0,
      previousSendingChainLength: 0,
      skippedMessageKeys: new Map(),
    });
  }

  /**
   * Initialize as the responder (Bob) after X3DH.
   * Bob uses his signed pre-key as the initial ratchet key pair.
   */
  static async initResponder(
    sharedSecret: Uint8Array,
    signedPreKeyPair: { publicKey: Uint8Array; privateKey: Uint8Array }
  ): Promise<DoubleRatchet> {
    return new DoubleRatchet({
      rootKey: sharedSecret,
      sendingChainKey: null,
      receivingChainKey: null,
      sendingRatchetKeyPair: signedPreKeyPair,
      receivingRatchetPublicKey: null,
      sendMessageNumber: 0,
      receiveMessageNumber: 0,
      previousSendingChainLength: 0,
      skippedMessageKeys: new Map(),
    });
  }

  /**
   * Encrypt a plaintext message.
   */
  async encrypt(plaintext: Uint8Array): Promise<EncryptedMessage> {
    const s = await initCrypto();

    if (!this.state.sendingChainKey || !this.state.sendingRatchetKeyPair) {
      throw new Error('Sending chain not initialized');
    }

    // Derive message key from sending chain key
    const [newChainKey, messageKey] = await DoubleRatchet.kdfCK(s, this.state.sendingChainKey);
    this.state.sendingChainKey = newChainKey;

    const header: MessageHeader = {
      dhPublicKey: this.state.sendingRatchetKeyPair.publicKey,
      previousChainLength: this.state.previousSendingChainLength,
      messageNumber: this.state.sendMessageNumber,
    };

    this.state.sendMessageNumber++;

    // Encrypt with XChaCha20-Poly1305
    const nonce = s.randombytes_buf(AEAD_NONCE_LENGTH);
    const ad = this.encodeHeader(header);
    const ciphertext = s.crypto_aead_xchacha20poly1305_ietf_encrypt(
      plaintext,
      ad,
      null, // nsec (unused)
      nonce,
      messageKey
    );

    // Zero out message key
    messageKey.fill(0);

    return { header, ciphertext, nonce };
  }

  /**
   * Decrypt an encrypted message.
   */
  async decrypt(message: EncryptedMessage): Promise<Uint8Array> {
    const s = await initCrypto();

    // Try skipped message keys first (handles out-of-order messages)
    const skippedKey = this.trySkippedMessageKey(message);
    if (skippedKey) {
      return skippedKey;
    }

    // Check if we need to perform a DH ratchet step
    const headerDHKey = message.header.dhPublicKey;
    if (
      !this.state.receivingRatchetPublicKey ||
      !this.constantTimeEquals(headerDHKey, this.state.receivingRatchetPublicKey)
    ) {
      // Skip any remaining messages in the previous receiving chain
      if (this.state.receivingChainKey) {
        await this.skipMessages(s, message.header.previousChainLength);
      }

      // DH ratchet step
      await this.dhRatchetStep(s, headerDHKey);
    }

    // Skip messages if needed in current receiving chain
    await this.skipMessages(s, message.header.messageNumber);

    if (!this.state.receivingChainKey) {
      throw new Error('Receiving chain not initialized');
    }

    // Derive message key from receiving chain key
    const [newChainKey, messageKey] = await DoubleRatchet.kdfCK(s, this.state.receivingChainKey);
    this.state.receivingChainKey = newChainKey;
    this.state.receiveMessageNumber++;

    // Decrypt
    const ad = this.encodeHeader(message.header);
    try {
      const plaintext = s.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null, // nsec
        message.ciphertext,
        ad,
        message.nonce,
        messageKey
      );

      messageKey.fill(0);
      return plaintext;
    } catch {
      messageKey.fill(0);
      throw new Error('Message decryption failed: authentication error');
    }
  }

  /**
   * Perform a DH ratchet step when receiving a new ratchet public key.
   */
  private async dhRatchetStep(s: typeof sodium, newRatchetPublicKey: Uint8Array): Promise<void> {
    this.state.previousSendingChainLength = this.state.sendMessageNumber;
    this.state.sendMessageNumber = 0;
    this.state.receiveMessageNumber = 0;
    this.state.receivingRatchetPublicKey = newRatchetPublicKey;

    if (!this.state.sendingRatchetKeyPair) {
      throw new Error('No sending ratchet key pair');
    }

    // DH with new receiving ratchet key and our current sending key
    const dhReceive = s.crypto_scalarmult(
      this.state.sendingRatchetKeyPair.privateKey,
      newRatchetPublicKey
    );
    const [newRootKey1, receivingChainKey] = await DoubleRatchet.kdfRK(
      s,
      this.state.rootKey,
      dhReceive
    );
    this.state.rootKey = newRootKey1;
    this.state.receivingChainKey = receivingChainKey;

    // Generate new sending ratchet key pair
    const newSendingKeyPair = s.crypto_box_keypair();

    // DH with our new sending key and the receiving ratchet key
    const dhSend = s.crypto_scalarmult(newSendingKeyPair.privateKey, newRatchetPublicKey);
    const [newRootKey2, sendingChainKey] = await DoubleRatchet.kdfRK(
      s,
      this.state.rootKey,
      dhSend
    );
    this.state.rootKey = newRootKey2;
    this.state.sendingChainKey = sendingChainKey;

    // Zero out old key pair
    if (this.state.sendingRatchetKeyPair.privateKey) {
      this.state.sendingRatchetKeyPair.privateKey.fill(0);
    }
    this.state.sendingRatchetKeyPair = newSendingKeyPair;

    dhReceive.fill(0);
    dhSend.fill(0);
  }

  /**
   * Skip messages in the current receiving chain (for out-of-order delivery).
   */
  private async skipMessages(s: typeof sodium, until: number): Promise<void> {
    if (!this.state.receivingChainKey) return;

    if (until - this.state.receiveMessageNumber > MAX_SKIP) {
      throw new Error(`Too many skipped messages (${until - this.state.receiveMessageNumber})`);
    }

    while (this.state.receiveMessageNumber < until) {
      const [newChainKey, messageKey] = await DoubleRatchet.kdfCK(
        s,
        this.state.receivingChainKey
      );
      this.state.receivingChainKey = newChainKey;

      const keyLabel = this.skippedKeyLabel(
        this.state.receivingRatchetPublicKey!,
        this.state.receiveMessageNumber
      );
      this.state.skippedMessageKeys.set(keyLabel, messageKey);
      this.state.receiveMessageNumber++;
    }
  }

  /**
   * Try to decrypt using a previously skipped message key.
   */
  private trySkippedMessageKey(message: EncryptedMessage): Uint8Array | null {
    const keyLabel = this.skippedKeyLabel(
      message.header.dhPublicKey,
      message.header.messageNumber
    );
    const messageKey = this.state.skippedMessageKeys.get(keyLabel);
    if (!messageKey) return null;

    this.state.skippedMessageKeys.delete(keyLabel);

    const ad = this.encodeHeader(message.header);
    try {
      const plaintext = sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
        null,
        message.ciphertext,
        ad,
        message.nonce,
        messageKey
      );
      messageKey.fill(0);
      return plaintext;
    } catch {
      messageKey.fill(0);
      return null;
    }
  }

  /**
   * Root key KDF: derive new root key and chain key from DH output.
   * Uses BLAKE2b-based HKDF-like construction.
   */
  private static async kdfRK(
    s: typeof sodium,
    rootKey: Uint8Array,
    dhOutput: Uint8Array
  ): Promise<[Uint8Array, Uint8Array]> {
    const info = new TextEncoder().encode(ROOT_KEY_INFO);
    const input = new Uint8Array([...rootKey, ...dhOutput]);

    // Extract: PRK = BLAKE2b(salt=rootKey, input=dhOutput)
    const prk = s.crypto_generichash(64, dhOutput, rootKey);

    // Expand: derive two 32-byte keys
    const expand1Input = new Uint8Array([...info, 0x01]);
    const newRootKey = s.crypto_generichash(AEAD_KEY_LENGTH, expand1Input, prk);

    const expand2Input = new Uint8Array([...info, ...newRootKey, 0x02]);
    const chainKey = s.crypto_generichash(AEAD_KEY_LENGTH, expand2Input, prk);

    prk.fill(0);
    input.fill(0);

    return [newRootKey, chainKey];
  }

  /**
   * Chain key KDF: derive new chain key and message key.
   */
  private static async kdfCK(
    s: typeof sodium,
    chainKey: Uint8Array
  ): Promise<[Uint8Array, Uint8Array]> {
    const chainInfo = new TextEncoder().encode(CHAIN_KEY_INFO);
    const msgInfo = new TextEncoder().encode(MESSAGE_KEY_INFO);

    // Chain key = BLAKE2b(key=chainKey, input=chain_info || 0x01)
    const ckInput = new Uint8Array([...chainInfo, 0x01]);
    const newChainKey = s.crypto_generichash(AEAD_KEY_LENGTH, ckInput, chainKey);

    // Message key = BLAKE2b(key=chainKey, input=msg_info || 0x02)
    const mkInput = new Uint8Array([...msgInfo, 0x02]);
    const messageKey = s.crypto_generichash(AEAD_KEY_LENGTH, mkInput, chainKey);

    return [newChainKey, messageKey];
  }

  /**
   * Encode a message header as associated data for AEAD.
   */
  private encodeHeader(header: MessageHeader): Uint8Array {
    const encoder = new TextEncoder();
    const meta = encoder.encode(
      `${header.previousChainLength}:${header.messageNumber}`
    );
    return new Uint8Array([...header.dhPublicKey, ...meta]);
  }

  /**
   * Create a label for skipped message key storage.
   */
  private skippedKeyLabel(dhPublicKey: Uint8Array, messageNumber: number): string {
    return `${Buffer.from(dhPublicKey).toString('hex')}:${messageNumber}`;
  }

  /**
   * Constant-time comparison of two Uint8Arrays.
   */
  private constantTimeEquals(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    return sodium.memcmp(a, b);
  }

  /**
   * Export ratchet state for encrypted vault storage.
   */
  exportState(): RatchetState {
    return {
      ...this.state,
      skippedMessageKeys: new Map(this.state.skippedMessageKeys),
    };
  }

  /**
   * Import ratchet state from vault.
   */
  static fromState(state: RatchetState): DoubleRatchet {
    return new DoubleRatchet({
      ...state,
      skippedMessageKeys: new Map(state.skippedMessageKeys),
    });
  }

  /**
   * Securely clear all ratchet state.
   */
  destroy(): void {
    this.state.rootKey.fill(0);
    this.state.sendingChainKey?.fill(0);
    this.state.receivingChainKey?.fill(0);
    if (this.state.sendingRatchetKeyPair) {
      this.state.sendingRatchetKeyPair.privateKey.fill(0);
    }
    for (const key of this.state.skippedMessageKeys.values()) {
      key.fill(0);
    }
    this.state.skippedMessageKeys.clear();
  }
}
