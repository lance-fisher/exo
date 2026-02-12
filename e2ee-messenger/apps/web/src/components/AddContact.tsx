'use client';

import { useState, useCallback } from 'react';
import { Search, QrCode, UserPlus, AlertTriangle, ShieldAlert } from 'lucide-react';
import { type Contact } from '@/lib/store';

interface AddContactProps {
  onAdd: (contact: Contact) => void;
}

export function AddContact({ onAdd }: AddContactProps) {
  const [mode, setMode] = useState<'fingerprint' | 'qr'>('fingerprint');
  const [fingerprint, setFingerprint] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleLookup = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const cleanFingerprint = fingerprint.replace(/\s/g, '').toLowerCase();

      if (cleanFingerprint.length !== 40) {
        throw new Error('PGP fingerprint must be 40 hex characters');
      }

      if (!/^[0-9a-f]{40}$/.test(cleanFingerprint)) {
        throw new Error('Invalid fingerprint format');
      }

      if (!displayName.trim()) {
        throw new Error('Please enter a display name');
      }

      // In production: call lookupIdentity() and verify attestation
      // For MVP, simulate lookup
      await new Promise(r => setTimeout(r, 600));

      onAdd({
        fingerprint: cleanFingerprint,
        displayName: displayName.trim(),
        messagingIdentityPublicKey: '', // Would come from rendezvous lookup
        status: 'unverified', // Fetched from rendezvous only
        connectionStatus: 'offline',
        unreadCount: 0,
      });
    } catch (err: any) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [fingerprint, displayName, onAdd]);

  return (
    <div className="p-4 space-y-4">
      {/* Mode toggle */}
      <div className="flex rounded-lg bg-[rgb(var(--color-surface))] p-1">
        <button
          onClick={() => setMode('fingerprint')}
          className={`flex-1 text-sm py-2 rounded-md transition-colors ${
            mode === 'fingerprint'
              ? 'bg-[rgb(var(--color-bg))] shadow-sm font-medium'
              : 'text-[rgb(var(--color-text-secondary))]'
          }`}
        >
          Fingerprint
        </button>
        <button
          onClick={() => setMode('qr')}
          className={`flex-1 text-sm py-2 rounded-md transition-colors ${
            mode === 'qr'
              ? 'bg-[rgb(var(--color-bg))] shadow-sm font-medium'
              : 'text-[rgb(var(--color-text-secondary))]'
          }`}
        >
          QR Code
        </button>
      </div>

      {mode === 'fingerprint' && (
        <div className="space-y-3">
          <div>
            <label className="block text-sm font-medium mb-1">Display Name</label>
            <input
              type="text"
              value={displayName}
              onChange={e => setDisplayName(e.target.value)}
              placeholder="Alice"
              className="input-field text-sm"
            />
          </div>

          <div>
            <label className="block text-sm font-medium mb-1">PGP Fingerprint</label>
            <input
              type="text"
              value={fingerprint}
              onChange={e => setFingerprint(e.target.value)}
              placeholder="ABCD 1234 5678 9012 ..."
              className="input-field text-sm font-mono"
            />
            <p className="text-xs text-[rgb(var(--color-text-secondary))] mt-1">
              40-character hex fingerprint from their PGP key
            </p>
          </div>

          <div className="bg-yellow-50 dark:bg-yellow-950/20 rounded-lg p-3 flex items-start gap-2">
            <ShieldAlert className="w-4 h-4 text-yellow-500 mt-0.5 flex-shrink-0" />
            <p className="text-xs text-yellow-700 dark:text-yellow-400">
              Contacts added by fingerprint lookup are marked as <strong>Unverified</strong> until
              you compare Safety Numbers out-of-band (in person or via a trusted channel).
            </p>
          </div>

          <button
            onClick={handleLookup}
            disabled={loading || !fingerprint.trim() || !displayName.trim()}
            className="w-full btn-primary flex items-center justify-center gap-2 text-sm"
          >
            {loading ? (
              'Looking up...'
            ) : (
              <>
                <UserPlus className="w-4 h-4" />
                Add Contact
              </>
            )}
          </button>
        </div>
      )}

      {mode === 'qr' && (
        <div className="text-center space-y-4 py-6">
          <QrCode className="w-16 h-16 mx-auto text-[rgb(var(--color-text-secondary))] opacity-30" />
          <div className="space-y-1">
            <p className="text-sm font-medium">Scan QR Code</p>
            <p className="text-xs text-[rgb(var(--color-text-secondary))]">
              Have your contact show their QR code, then scan it with your camera.
              QR verification marks the contact as <strong>Verified</strong>.
            </p>
          </div>
          <button className="btn-secondary text-sm">
            Open Camera
          </button>
        </div>
      )}

      {error && (
        <div className="flex items-center gap-2 text-red-500 text-sm bg-red-50 dark:bg-red-950/20 rounded-lg p-3">
          <AlertTriangle className="w-4 h-4 flex-shrink-0" />
          {error}
        </div>
      )}
    </div>
  );
}
