'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import {
  startPasskeyRegistration,
  completePasskeyRegistration,
} from '@/lib/auth';
import { api } from '@/lib/api';
import Button from '@/components/ui/Button';
import Card from '@/components/ui/Card';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import {
  Shield,
  Laptop,
  Smartphone,
  CheckCircle,
  ChevronRight,
} from 'lucide-react';

type EnrollStep = 'code' | 'passkey' | 'totp' | 'confirm';

function detectDeviceType(): 'laptop' | 'iphone' | 'desktop' | 'tablet' {
  if (typeof navigator === 'undefined') return 'desktop';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('iphone')) return 'iphone';
  if (ua.includes('ipad') || (ua.includes('tablet') && ua.includes('mobile'))) return 'tablet';
  if (ua.includes('mobile') || ua.includes('android')) return 'iphone';
  return 'laptop';
}

export default function EnrollPage() {
  const router = useRouter();
  const [step, setStep] = useState<EnrollStep>('code');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [enrollmentCode, setEnrollmentCode] = useState('');
  const [deviceName, setDeviceName] = useState('');
  const [credential, setCredential] = useState<unknown>(null);
  const [totpSecret, setTotpSecret] = useState('');
  const [totpQrUri, setTotpQrUri] = useState('');
  const [totpCode, setTotpCode] = useState('');
  const deviceType = detectDeviceType();

  const handleVerifyCode = useCallback(async () => {
    setLoading(true);
    setError(null);
    const { data, error: apiError } = await api.enrollment.verify(enrollmentCode);
    if (apiError || !data?.valid) {
      setError(apiError || 'Invalid or expired enrollment code.');
      setLoading(false);
      return;
    }
    setStep('passkey');
    setLoading(false);
  }, [enrollmentCode]);

  const handleRegisterPasskey = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await startPasskeyRegistration();
    if (!result.success) {
      setError(result.error || 'Passkey registration failed.');
      setLoading(false);
      return;
    }
    setCredential(result.credential);

    // Provision TOTP
    const { data: totpData, error: totpError } = await api.auth.provisionTotp();
    if (totpError || !totpData) {
      setError(totpError || 'Failed to provision TOTP.');
      setLoading(false);
      return;
    }
    setTotpSecret(totpData.secret);
    setTotpQrUri(totpData.qrUri ?? totpData.otpauthUri);
    setStep('totp');
    setLoading(false);
  }, []);

  const handleConfirmTotp = useCallback(async () => {
    if (totpCode.length !== 6) {
      setError('Enter a 6-digit code.');
      return;
    }
    setLoading(true);
    setError(null);

    // Complete passkey registration
    const regResult = await completePasskeyRegistration(credential);
    if (!regResult.success) {
      setError(regResult.error || 'Failed to complete registration.');
      setLoading(false);
      return;
    }

    // Complete enrollment
    const { error: enrollError } = await api.enrollment.complete({
      deviceName: deviceName || `${deviceType} device`,
      totpSecret,
    });
    if (enrollError) {
      setError(enrollError);
      setLoading(false);
      return;
    }

    setStep('confirm');
    setLoading(false);
  }, [totpCode, credential, deviceName, deviceType, totpSecret]);

  const stepIndicators = [
    { key: 'code', label: 'Code' },
    { key: 'passkey', label: 'Passkey' },
    { key: 'totp', label: 'TOTP' },
    { key: 'confirm', label: 'Done' },
  ];
  const currentStepIndex = stepIndicators.findIndex((s) => s.key === step);

  return (
    <div className="flex min-h-screen items-center justify-center bg-surface p-4">
      <div className="w-full max-w-lg animate-fade-in">
        <div className="mb-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-border bg-surface-raised">
            <Shield className="h-6 w-6 text-accent-blue" />
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Device Enrollment
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Register this device for sovereign console access.
          </p>
        </div>

        {/* Step indicators */}
        <div className="mb-6 flex items-center justify-center gap-2">
          {stepIndicators.map((s, i) => (
            <div key={s.key} className="flex items-center gap-2">
              <div
                className={`flex h-7 w-7 items-center justify-center rounded-full text-xs font-medium ${
                  i <= currentStepIndex
                    ? 'bg-accent-blue text-white'
                    : 'bg-surface-raised text-text-muted border border-border'
                }`}
              >
                {i + 1}
              </div>
              <span
                className={`text-xs ${
                  i <= currentStepIndex ? 'text-text-primary' : 'text-text-muted'
                }`}
              >
                {s.label}
              </span>
              {i < stepIndicators.length - 1 && (
                <ChevronRight className="h-3 w-3 text-text-muted" />
              )}
            </div>
          ))}
        </div>

        <Card>
          {/* Detected device */}
          <div className="mb-6 flex items-center gap-3 rounded-lg border border-border bg-surface p-3">
            {deviceType === 'iphone' || deviceType === 'tablet' ? (
              <Smartphone className="h-5 w-5 text-text-secondary" />
            ) : (
              <Laptop className="h-5 w-5 text-text-secondary" />
            )}
            <div>
              <p className="text-sm font-medium text-text-primary">
                Detected: {deviceType.charAt(0).toUpperCase() + deviceType.slice(1)}
              </p>
              <p className="text-xs text-text-muted">
                Platform-bound passkey will be created for this device.
              </p>
            </div>
            <Badge variant="info" className="ml-auto">
              {deviceType}
            </Badge>
          </div>

          {error && (
            <div className="mb-4 rounded-lg border border-accent-red/20 bg-accent-red/5 p-3">
              <p className="text-sm text-accent-red">{error}</p>
            </div>
          )}

          {step === 'code' && (
            <div className="space-y-4">
              <Input
                label="Enrollment Code"
                placeholder="Enter your enrollment code"
                value={enrollmentCode}
                onChange={(e) => setEnrollmentCode(e.target.value)}
              />
              <Input
                label="Device Name (optional)"
                placeholder="e.g., Work Laptop"
                value={deviceName}
                onChange={(e) => setDeviceName(e.target.value)}
              />
              <Button
                variant="primary"
                className="w-full"
                onClick={handleVerifyCode}
                loading={loading}
                disabled={!enrollmentCode.trim()}
              >
                Verify Code
              </Button>
            </div>
          )}

          {step === 'passkey' && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-lg font-medium text-text-primary">
                  Register Passkey
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Your browser will prompt you to create a passkey bound to this
                  device.
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full"
                onClick={handleRegisterPasskey}
                loading={loading}
              >
                Create Passkey
              </Button>
            </div>
          )}

          {step === 'totp' && (
            <div className="space-y-4">
              <div className="text-center">
                <h2 className="text-lg font-medium text-text-primary">
                  Provision Authenticator
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  Scan the QR code with your authenticator app, then enter the
                  verification code.
                </p>
              </div>
              {totpQrUri && (
                <div className="flex justify-center rounded-lg border border-border bg-white p-4">
                  {/* QR code rendered by a library in production; showing URI for now */}
                  <div className="text-center">
                    <p className="break-all font-mono text-xs text-gray-800">
                      {totpQrUri}
                    </p>
                  </div>
                </div>
              )}
              <div className="rounded-lg border border-border bg-surface p-3">
                <p className="mb-1 text-xs text-text-muted">Manual entry key:</p>
                <p className="font-mono text-sm text-text-primary tracking-wider">
                  {totpSecret}
                </p>
              </div>
              <Input
                label="Verification Code"
                placeholder="000000"
                value={totpCode}
                onChange={(e) =>
                  setTotpCode(e.target.value.replace(/\D/g, '').slice(0, 6))
                }
                variant="code"
                maxLength={6}
              />
              <Button
                variant="primary"
                className="w-full"
                onClick={handleConfirmTotp}
                loading={loading}
                disabled={totpCode.length !== 6}
              >
                Confirm and Complete
              </Button>
            </div>
          )}

          {step === 'confirm' && (
            <div className="space-y-6 text-center">
              <CheckCircle className="mx-auto h-12 w-12 text-accent-green" />
              <div>
                <h2 className="text-lg font-medium text-text-primary">
                  Enrollment Complete
                </h2>
                <p className="mt-1 text-sm text-text-secondary">
                  This device is now enrolled and bound to your passkey.
                </p>
              </div>
              <Button
                variant="primary"
                className="w-full"
                onClick={() => router.replace('/auth')}
              >
                Continue to Login
              </Button>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}
