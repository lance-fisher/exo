/**
 * WebAuthn (Passkey) integration for local authentication.
 *
 * Used for:
 * 1. Initial setup: Create a passkey credential
 * 2. App unlock: Assert passkey to derive vault wrapping key
 * 3. Step-up auth: Re-assert passkey before message send
 *
 * The assertion signature is used to derive the vault encryption key,
 * ensuring the vault can only be decrypted after successful biometric/passkey auth.
 */

const RP_NAME = 'E2EE Messenger';
const RP_ID = typeof window !== 'undefined' ? window.location.hostname : 'localhost';

export interface WebAuthnCredential {
  credentialId: string; // base64url
  publicKey: string; // base64
}

/**
 * Check if WebAuthn is supported in this browser.
 */
export function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' &&
    !!window.PublicKeyCredential &&
    typeof window.PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable === 'function';
}

/**
 * Check if platform authenticator (biometric/passkey) is available.
 */
export async function isPlatformAuthenticatorAvailable(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

/**
 * Register a new passkey credential.
 * Called during initial account setup.
 */
export async function registerPasskey(
  userId: string,
  userName: string
): Promise<{ credential: WebAuthnCredential; attestation: Uint8Array }> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const createOptions: PublicKeyCredentialCreationOptions = {
    challenge,
    rp: {
      name: RP_NAME,
      id: RP_ID,
    },
    user: {
      id: new TextEncoder().encode(userId),
      name: userName,
      displayName: userName,
    },
    pubKeyCredParams: [
      { alg: -7, type: 'public-key' },   // ES256
      { alg: -257, type: 'public-key' },  // RS256
    ],
    authenticatorSelection: {
      authenticatorAttachment: 'platform',
      userVerification: 'required',
      residentKey: 'required',
      requireResidentKey: true,
    },
    timeout: 60000,
    attestation: 'none', // We don't need attestation from the authenticator
  };

  const credential = await navigator.credentials.create({
    publicKey: createOptions,
  }) as PublicKeyCredential;

  const response = credential.response as AuthenticatorAttestationResponse;

  return {
    credential: {
      credentialId: bufferToBase64url(credential.rawId),
      publicKey: bufferToBase64(response.getPublicKey()!),
    },
    attestation: new Uint8Array(response.attestationObject),
  };
}

/**
 * Assert a passkey credential (authenticate).
 * Used for app unlock and step-up auth.
 *
 * Returns the assertion signature which is used to derive the vault key.
 */
export async function assertPasskey(
  credentialId: string
): Promise<{ signature: Uint8Array; authenticatorData: Uint8Array }> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));

  const getOptions: PublicKeyCredentialRequestOptions = {
    challenge,
    rpId: RP_ID,
    allowCredentials: [{
      id: base64urlToBuffer(credentialId),
      type: 'public-key',
      transports: ['internal'],
    }],
    userVerification: 'required',
    timeout: 60000,
  };

  const assertion = await navigator.credentials.get({
    publicKey: getOptions,
  }) as PublicKeyCredential;

  const response = assertion.response as AuthenticatorAssertionResponse;

  return {
    signature: new Uint8Array(response.signature),
    authenticatorData: new Uint8Array(response.authenticatorData),
  };
}

// ---- Utility functions ----

function bufferToBase64url(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let str = '';
  for (const byte of bytes) {
    str += String.fromCharCode(byte);
  }
  return btoa(str);
}

function base64urlToBuffer(base64url: string): ArrayBuffer {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - base64.length % 4) % 4);
  const binary = atob(padded);
  const buffer = new ArrayBuffer(binary.length);
  const view = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    view[i] = binary.charCodeAt(i);
  }
  return buffer;
}
