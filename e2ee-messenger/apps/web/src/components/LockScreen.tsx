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
      // In production, this would:
      // 1. Assert WebAuthn passkey
      // 2. Use assertion signature to derive vault wrapping key
      // 3. Unwrap vault key
      // 4. Decrypt vault
      // 5. Load identity info

      // For MVP demo, simulate the flow
      const vault = localStorage.getItem('e2ee_vault');
      if (!vault) {
        throw new Error('No vault found. Please set up your account first.');
      }

      // Simulate WebAuthn assertion
      const storedIdentity = localStorage.getItem('e2ee_identity');
      if (!storedIdentity) {
        throw new Error('No identity found.');
      }

      const identity = JSON.parse(storedIdentity);

      // Small delay to simulate biometric check
      await new Promise(r => setTimeout(r, 500));

      onUnlock(identity.fingerprint, identity.deviceId);
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
