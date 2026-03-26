'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { startPasskeyAuth, verifyTotp } from '@/lib/auth';
import PasskeyPrompt from '@/components/auth/PasskeyPrompt';
import TotpInput from '@/components/auth/TotpInput';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import { Shield, AlertTriangle } from 'lucide-react';

type AuthStep = 'passkey' | 'totp' | 'error';

export default function AuthPage() {
  const router = useRouter();
  const [step, setStep] = useState<AuthStep>('passkey');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handlePasskeyAuth = useCallback(async () => {
    setLoading(true);
    setError(null);

    const result = await startPasskeyAuth();

    if (result.success) {
      router.replace('/dashboard');
      return;
    }

    if (result.requiresTotp) {
      setStep('totp');
      setLoading(false);
      return;
    }

    setError(result.error || 'Authentication failed.');
    setStep('error');
    setLoading(false);
  }, [router]);

  const handleTotpVerify = useCallback(
    async (code: string) => {
      setLoading(true);
      setError(null);

      const result = await verifyTotp(code);

      if (result.success) {
        router.replace('/dashboard');
        return;
      }

      setError(result.error || 'Verification failed.');
      setLoading(false);
    },
    [router]
  );

  const handleRetry = useCallback(() => {
    setStep('passkey');
    setError(null);
  }, []);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-md animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-raised">
            <Shield className="h-6 w-6 text-accent-blue" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Sovereign Console
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Private Operator Access
          </p>
        </div>

        <Card>
          {step === 'passkey' && (
            <PasskeyPrompt onAuthenticate={handlePasskeyAuth} loading={loading} />
          )}

          {step === 'totp' && (
            <div className="space-y-6">
              <div className="text-center">
                <h2 className="text-lg font-medium text-text-primary">
                  Step-Up Verification
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Enter the 6-digit code from your authenticator.
                </p>
              </div>
              <TotpInput
                onComplete={handleTotpVerify}
                loading={loading}
                error={error}
              />
            </div>
          )}

          {step === 'error' && (
            <div className="space-y-6">
              <div className="flex items-start gap-3 rounded-lg border border-accent-red/20 bg-accent-red/5 p-4">
                <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-accent-red" />
                <div>
                  <p className="text-sm font-medium text-accent-red">
                    Authentication Failed
                  </p>
                  <p className="mt-1 text-sm text-text-secondary">{error}</p>
                </div>
              </div>
              <Button variant="primary" className="w-full" onClick={handleRetry}>
                Try Again
              </Button>
            </div>
          )}
        </Card>

        <p className="mt-6 text-center text-xs text-text-muted">
          Access is restricted to enrolled devices with valid passkeys.
        </p>
      </div>
    </div>
  );
}
