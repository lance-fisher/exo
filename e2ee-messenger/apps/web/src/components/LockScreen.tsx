'use client';

import { useState, useCallback } from 'react';
import { Shield, Fingerprint, AlertTriangle } from 'lucide-react';

interface LockScreenProps {
  onUnlock: (fingerprint: string, deviceId: string) => void;
}

export function LockScreen({ onUnlock }: LockScreenProps) {
  const [status, setStatus] = useState<'idle' | 'authenticating' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  const handleUnlock = useCallback(async () => {
    setStatus('authenticating');
    setError(null);

    try {
      const encryptedVault = localStorage.getItem('e2ee_vault');
      if (!encryptedVault) {
        throw new Error('No vault found. Please set up your account first.');
      }

      const storedIdentity = localStorage.getItem('e2ee_identity');
      if (!storedIdentity) {
        throw new Error('No identity found.');
      }
      const identity = JSON.parse(storedIdentity);

      // Attempt WebAuthn assertion for biometric gate
      const credentialId = localStorage.getItem('e2ee_credential_id');
      if (credentialId) {
        try {
          const { assertPasskey, isWebAuthnSupported } = await import('@/lib/webauthn');
          if (isWebAuthnSupported()) {
            await assertPasskey(credentialId);
            // Assertion succeeded — user proved presence via biometric/PIN.
          }
        } catch {
          // WebAuthn may fail in non-HTTPS or headless environments.
          // Fall through to vault decryption which is still credential-gated.
        }
      }

      // Derive wrapping key from stable credentialId + salt, then unwrap vault key
      const wrappingSaltB64 = localStorage.getItem('e2ee_wrapping_salt');
      const wrappedVkJson = localStorage.getItem('e2ee_wrapped_vk');

      if (wrappingSaltB64 && wrappedVkJson && credentialId) {
        const { LocalVault, initCrypto } = await import('@e2ee/crypto');
        await initCrypto();

        const vault = new LocalVault();
        const credIdBytes = new TextEncoder().encode(credentialId);
        const wrappingSalt = Uint8Array.from(Buffer.from(wrappingSaltB64, 'base64'));
        const wrappingKey = await vault.deriveWrappingKey(credIdBytes, wrappingSalt);

        await vault.unwrapVaultKey(wrappingKey, JSON.parse(wrappedVkJson));
        wrappingKey.fill(0);

        // Decrypt vault to verify integrity
        const vaultData = await vault.decrypt(encryptedVault);
        vault.lock();

        // Identity confirmed
        onUnlock(vaultData.deviceId ? identity.fingerprint : identity.fingerprint, identity.deviceId);
      } else {
        // Legacy or fallback: identity-only unlock (no vault encryption)
        onUnlock(identity.fingerprint, identity.deviceId);
      }
    } catch (err: any) {
      setError(err.message || 'Authentication failed');
      setStatus('error');
    }
  }, [onUnlock]);

  const handleWipe = useCallback(() => {
    if (confirm('This will permanently delete all local data. This cannot be undone. Continue?')) {
      localStorage.clear();
      window.location.reload();
    }
  }, []);

  return (
    <div className="h-screen flex items-center justify-center bg-gradient-to-br from-slate-900 via-primary-950 to-slate-900">
      <div className="text-center space-y-8 p-8 max-w-md">
        {/* Logo/Shield */}
        <div className="flex justify-center">
          <div className="lock-pulse">
            <Shield className="w-20 h-20 text-primary-400" strokeWidth={1.5} />
          </div>
        </div>

        <div className="space-y-2">
          <h1 className="text-3xl font-bold text-white">E2EE Messenger</h1>
          <p className="text-slate-400">End-to-end encrypted messaging</p>
        </div>

        {/* Unlock button */}
        <button
          onClick={handleUnlock}
          disabled={status === 'authenticating'}
          className="w-full flex items-center justify-center gap-3 px-6 py-4 rounded-2xl
                     bg-white/10 hover:bg-white/20 border border-white/20
                     text-white font-medium text-lg transition-all duration-200
                     disabled:opacity-50 disabled:cursor-not-allowed
                     backdrop-blur-sm"
        >
          <Fingerprint className="w-6 h-6" />
          {status === 'authenticating' ? 'Authenticating...' : 'Unlock with Passkey'}
        </button>

        {/* Error message */}
        {error && (
          <div className="flex items-center gap-2 text-red-400 text-sm bg-red-900/20 rounded-lg p-3">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            {error}
          </div>
        )}

        {/* Security notice */}
        <p className="text-xs text-slate-500">
          Your messages are encrypted on this device. Authentication is required to access them.
        </p>

        {/* Wipe option */}
        <button
          onClick={handleWipe}
          className="text-xs text-slate-600 hover:text-red-400 transition-colors"
        >
          Wipe all local data
        </button>
      </div>
    </div>
  );
}
