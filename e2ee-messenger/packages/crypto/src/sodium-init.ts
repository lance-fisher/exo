import sodium from 'libsodium-wrappers-sumo';

let initialized = false;

/**
 * Initialize libsodium. Must be called before any crypto operations.
 * Safe to call multiple times - will only initialize once.
 */
export async function initCrypto(): Promise<typeof sodium> {
  if (!initialized) {
    await sodium.ready;
    initialized = true;
  }
  return sodium;
}
