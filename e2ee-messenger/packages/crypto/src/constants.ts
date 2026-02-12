/** Length of salt for HKDF derivations (32 bytes) */
export const HKDF_SALT_LENGTH = 32;

/** AEAD key length for XChaCha20-Poly1305 (32 bytes) */
export const AEAD_KEY_LENGTH = 32;

/** AEAD nonce length for XChaCha20-Poly1305 (24 bytes) */
export const AEAD_NONCE_LENGTH = 24;

/** Maximum number of message keys to skip in a ratchet chain */
export const MAX_SKIP = 1000;

/** Maximum number of one-time prekeys to generate */
export const MAX_PREKEYS = 100;

/** Info string for root key HKDF derivation */
export const ROOT_KEY_INFO = 'e2ee-messenger-root-key';

/** Info string for chain key HKDF derivation */
export const CHAIN_KEY_INFO = 'e2ee-messenger-chain-key';

/** Info string for message key HKDF derivation */
export const MESSAGE_KEY_INFO = 'e2ee-messenger-message-key';

/** Info string for X3DH shared secret derivation */
export const X3DH_INFO = 'e2ee-messenger-x3dh';

/** Info string for vault key derivation */
export const VAULT_KEY_INFO = 'e2ee-messenger-vault';

/** Attestation statement version */
export const ATTESTATION_VERSION = 1;

/** Maximum age of a signed prekey before rotation (7 days in ms) */
export const SIGNED_PREKEY_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;
