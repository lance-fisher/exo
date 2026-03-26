'use client';

import Button from '@/components/ui/Button';
import { Fingerprint } from 'lucide-react';

interface PasskeyPromptProps {
  onAuthenticate: () => void;
  loading: boolean;
}

export default function PasskeyPrompt({
  onAuthenticate,
  loading,
}: PasskeyPromptProps) {
  return (
    <div className="space-y-6">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-2xl border border-border bg-surface">
          <Fingerprint className="h-8 w-8 text-accent-blue" />
        </div>
        <h2 className="text-lg font-medium text-text-primary">
          Authenticate with Passkey
        </h2>
        <p className="mt-2 text-sm text-text-secondary">
          Use your device&apos;s biometric or security key to verify your
          identity. Only registered devices are accepted.
        </p>
      </div>

      <Button
        variant="primary"
        className="w-full"
        onClick={onAuthenticate}
        loading={loading}
      >
        {loading ? 'Verifying...' : 'Verify Identity'}
      </Button>

      {loading && (
        <p className="text-center text-xs text-text-muted">
          Follow the prompt from your browser or device.
        </p>
      )}
    </div>
  );
}
