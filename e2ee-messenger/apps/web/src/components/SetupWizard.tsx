'use client';

import { useState, useCallback, useRef } from 'react';
import {
  Shield, Key, Fingerprint, CheckCircle, Copy, AlertTriangle, ChevronRight, Upload
} from 'lucide-react';
import {
  isWebAuthnSupported,
  isPlatformAuthenticatorAvailable,
  registerPasskey,
  type WebAuthnCredential,
} from '@/lib/webauthn';
import { publishIdentity } from '@/lib/api';

interface SetupWizardProps {
  onComplete: (fingerprint: string, deviceId: string) => void;
}

type Step = 'import-key' | 'create-passkey' | 'generate-identity' | 'recovery-code' | 'complete';

export function SetupWizard({ onComplete }: SetupWizardProps) {
  const [step, setStep] = useState<Step>('import-key');
  const [pgpKey, setPgpKey] = useState('');
  const [passphrase, setPassphrase] = useState('');
  const [fingerprint, setFingerprint] = useState('');
  const [recoveryCode, setRecoveryCode] = useState('');
  const [deviceId] = useState(() => `device-${crypto.randomUUID().slice(0, 8)}`);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [recoveryCopied, setRecoveryCopied] = useState(false);

  // Hold crypto objects across steps (not in React state to avoid serialization)
  const pgpIdentityRef = useRef<any>(null);
  const keyBundleRef = useRef<any>(null);
  const credentialRef = useRef<WebAuthnCredential | null>(null);

  const steps: { key: Step; label: string }[] = [
    { key: 'import-key', label: 'Import PGP Key' },
    { key: 'create-passkey', label: 'Create Passkey' },
    { key: 'generate-identity', label: 'Generate Identity' },
    { key: 'recovery-code', label: 'Recovery Code' },
  ];

  const currentStepIndex = steps.findIndex(s => s.key === step);

  const handleImportKey = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      if (!pgpKey.trim()) {
        throw new Error('Please paste your PGP private key');
      }

      if (!pgpKey.includes('-----BEGIN PGP PRIVATE KEY BLOCK-----')) {
        throw new Error('Invalid PGP key format. Please paste an ASCII-armored private key.');
      }

      // Dynamically import crypto to keep bundle small and avoid SSR issues
      const { PGPIdentity, initCrypto } = await import('@e2ee/crypto');
      await initCrypto();

      const pgpId = new PGPIdentity();
      const info = await pgpId.importPrivateKey(pgpKey.trim(), passphrase || undefined);

      pgpIdentityRef.current = pgpId;
      setFingerprint(info.fingerprint);
      setStep('create-passkey');
    } catch (err: any) {
      setError(err.message || 'Failed to import PGP key');
    } finally {
      setLoading(false);
    }
  }, [pgpKey, passphrase]);

  const handleCreatePasskey = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      // Check WebAuthn availability
      const webauthnOk = isWebAuthnSupported() && await isPlatformAuthenticatorAvailable();

      if (webauthnOk) {
        // Register a real passkey with platform authenticator
        const { credential } = await registerPasskey(fingerprint, `E2EE User ${fingerprint.slice(0, 8)}`);
        credentialRef.current = credential;
      } else {
        // Fallback: generate a synthetic credential ID for environments without WebAuthn
        // (e.g., headless testing, non-HTTPS localhost)
        const syntheticId = Array.from(crypto.getRandomValues(new Uint8Array(32)))
          .map(b => b.toString(16).padStart(2, '0')).join('');
        credentialRef.current = { credentialId: syntheticId, publicKey: '' };
      }

      setStep('generate-identity');
    } catch (err: any) {
      setError(err.message || 'Failed to create passkey. Your browser may not support WebAuthn.');
    } finally {
      setLoading(false);
    }
  }, [fingerprint]);

  const handleGenerateIdentity = useCallback(async () => {
    setError(null);
    setLoading(true);

    try {
      const { KeyBundle, LocalVault, generateRecoveryCode, initCrypto } = await import('@e2ee/crypto');
      const s = await initCrypto();

      const pgpId = pgpIdentityRef.current;
      if (!pgpId) throw new Error('PGP identity not loaded');
      if (!credentialRef.current) throw new Error('Passkey not created');

      // 1. Generate messaging identity key pair (Ed25519)
      const bundle = new KeyBundle();
      const identityPub = await bundle.generateIdentityKeyPair();
      const signedPreKey = await bundle.generateSignedPreKey();
      const oneTimePreKeys = await bundle.generateOneTimePreKeys(20);

      keyBundleRef.current = bundle;

      // 2. Sign attestation: PGP key signs the messaging identity key
      const attestation = await pgpId.signAttestation(identityPub, deviceId);

      // 3. Generate recovery code
      const { code: recCode, hash: recHash } = await generateRecoveryCode();
      setRecoveryCode(recCode);

      // 4. Create encrypted vault
      const vault = new LocalVault();
      const vaultKeyBytes = await vault.generateVaultKey();

      // 5. Derive wrapping key from credential ID and store wrapped vault key
      const credIdBytes = new TextEncoder().encode(credentialRef.current.credentialId);
      const wrappingSalt = s.randombytes_buf(32);
      const wrappingKey = await vault.deriveWrappingKey(credIdBytes, wrappingSalt);
      const wrappedVk = await vault.wrapVaultKey(wrappingKey);
      wrappingKey.fill(0);

      // 6. Encrypt vault data
      const vaultData = {
        pgpPrivateKeyArmored: pgpId.getArmoredPrivateKey(),
        identityKeyPair: {
          publicKey: Buffer.from(bundle.getIdentityPublicKey()).toString('base64'),
          privateKey: Buffer.from(bundle.getIdentityPrivateKey()).toString('base64'),
        },
        keyBundleExport: JSON.stringify(bundle.exportForVault(), (_, v) =>
          v instanceof Uint8Array ? { __uint8: Buffer.from(v).toString('base64') } : v
        ),
        ratchetSessions: {},
        deviceId,
        recoveryCodeHash: recHash,
        createdAt: Date.now(),
        version: 1,
      };

      const encryptedVault = await vault.encrypt(vaultData);

      // 7. Store everything in localStorage
      localStorage.setItem('e2ee_vault', encryptedVault);
      localStorage.setItem('e2ee_wrapping_salt', Buffer.from(wrappingSalt).toString('base64'));
      localStorage.setItem('e2ee_wrapped_vk', JSON.stringify(wrappedVk));
      localStorage.setItem('e2ee_credential_id', credentialRef.current.credentialId);
      localStorage.setItem('e2ee_identity', JSON.stringify({ fingerprint, deviceId }));

      // 8. Publish attestation and prekeys to rendezvous server (best-effort)
      try {
        await publishIdentity({
          attestation,
          signedPreKey: {
            keyId: signedPreKey.keyId,
            publicKey: Buffer.from(signedPreKey.publicKey).toString('base64'),
            signature: Buffer.from(signedPreKey.signature).toString('base64'),
            timestamp: signedPreKey.timestamp,
          },
          oneTimePreKeys: oneTimePreKeys.map(k => ({
            keyId: k.keyId,
            publicKey: Buffer.from(k.publicKey).toString('base64'),
          })),
        });
      } catch {
        // Server may be unavailable; identity is still usable locally
        console.warn('Could not publish to rendezvous server (will retry later)');
      }

      // 9. Clean up sensitive material from JS heap
      vault.lock();
      vaultKeyBytes.fill(0);

      setStep('recovery-code');
    } catch (err: any) {
      setError(err.message || 'Failed to generate identity');
    } finally {
      setLoading(false);
    }
  }, [fingerprint, deviceId]);

  const handleCopyRecovery = useCallback(() => {
    navigator.clipboard.writeText(recoveryCode).then(() => {
      setRecoveryCopied(true);
      setTimeout(() => setRecoveryCopied(false), 2000);
    });
  }, [recoveryCode]);

  const handleComplete = useCallback(() => {
    onComplete(fingerprint, deviceId);
  }, [fingerprint, deviceId, onComplete]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      const reader = new FileReader();
      reader.onload = (ev) => {
        setPgpKey(ev.target?.result as string);
      };
      reader.readAsText(file);
    }
  }, []);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-primary-950 to-slate-900 flex items-center justify-center p-4">
      <div className="w-full max-w-lg">
        {/* Header */}
        <div className="text-center mb-8">
          <Shield className="w-12 h-12 text-primary-400 mx-auto mb-4" />
          <h1 className="text-2xl font-bold text-white">Set Up E2EE Messenger</h1>
          <p className="text-slate-400 mt-1">Secure your identity in 4 steps</p>
        </div>

        {/* Progress bar */}
        <div className="flex items-center gap-2 mb-8">
          {steps.map((s, i) => (
            <div key={s.key} className="flex-1 flex items-center gap-2">
              <div
                className={`h-1.5 flex-1 rounded-full transition-colors duration-300 ${
                  i <= currentStepIndex ? 'bg-primary-500' : 'bg-slate-700'
                }`}
              />
            </div>
          ))}
        </div>

        {/* Step content */}
        <div className="bg-slate-800/50 backdrop-blur-sm rounded-2xl border border-slate-700 p-6">
          {/* Step 1: Import PGP Key */}
          {step === 'import-key' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Key className="w-5 h-5 text-primary-400" />
                <h2 className="text-lg font-semibold text-white">Import Your PGP Private Key</h2>
              </div>
              <p className="text-sm text-slate-400">
                Your PGP key anchors your identity. It will be encrypted and stored locally — never uploaded.
              </p>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  ASCII-Armored Private Key
                </label>
                <textarea
                  value={pgpKey}
                  onChange={e => setPgpKey(e.target.value)}
                  placeholder="-----BEGIN PGP PRIVATE KEY BLOCK-----&#10;&#10;Paste your key here...&#10;&#10;-----END PGP PRIVATE KEY BLOCK-----"
                  rows={8}
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 text-slate-200
                             border border-slate-600 focus:ring-2 focus:ring-primary-500
                             focus:border-transparent font-mono text-xs resize-none
                             placeholder:text-slate-600"
                />
              </div>

              <div className="flex items-center gap-3">
                <label className="flex items-center gap-2 text-sm text-slate-400 cursor-pointer
                                  hover:text-primary-400 transition-colors">
                  <Upload className="w-4 h-4" />
                  Or upload a .asc file
                  <input
                    type="file"
                    accept=".asc,.gpg,.pgp,.txt"
                    onChange={handleFileUpload}
                    className="hidden"
                  />
                </label>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-1">
                  Key Passphrase (if protected)
                </label>
                <input
                  type="password"
                  value={passphrase}
                  onChange={e => setPassphrase(e.target.value)}
                  placeholder="Optional"
                  className="w-full px-3 py-2 rounded-lg bg-slate-900 text-slate-200
                             border border-slate-600 focus:ring-2 focus:ring-primary-500
                             focus:border-transparent"
                />
              </div>

              <button
                onClick={handleImportKey}
                disabled={loading || !pgpKey.trim()}
                className="w-full btn-primary flex items-center justify-center gap-2"
              >
                {loading ? 'Importing...' : 'Import Key'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 2: Create Passkey */}
          {step === 'create-passkey' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Fingerprint className="w-5 h-5 text-primary-400" />
                <h2 className="text-lg font-semibold text-white">Create a Passkey</h2>
              </div>
              <p className="text-sm text-slate-400">
                A passkey protects your local data. You&apos;ll use biometrics or your device PIN to
                unlock the app each time you open it.
              </p>

              <div className="bg-slate-900/50 rounded-lg p-4 space-y-2">
                <div className="flex items-center gap-2 text-sm text-slate-300">
                  <CheckCircle className="w-4 h-4 text-green-400" />
                  PGP key imported successfully
                </div>
                <div className="text-xs text-slate-500 font-mono">
                  Fingerprint: {fingerprint.match(/.{4}/g)?.join(' ')}
                </div>
              </div>

              <button
                onClick={handleCreatePasskey}
                disabled={loading}
                className="w-full btn-primary flex items-center justify-center gap-2"
              >
                {loading ? 'Creating...' : 'Create Passkey'}
                <Fingerprint className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 3: Generate Identity */}
          {step === 'generate-identity' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Shield className="w-5 h-5 text-primary-400" />
                <h2 className="text-lg font-semibold text-white">Generate Messaging Identity</h2>
              </div>
              <p className="text-sm text-slate-400">
                A separate Ed25519 key pair will be generated for messaging. Your PGP key will sign
                an attestation binding this new key to your identity.
              </p>

              <div className="bg-slate-900/50 rounded-lg p-4 space-y-2 text-sm text-slate-400">
                <p>This will:</p>
                <ul className="list-disc list-inside space-y-1 text-xs">
                  <li>Generate an Ed25519 identity key pair</li>
                  <li>Generate signed pre-keys for key agreement</li>
                  <li>Generate one-time pre-keys</li>
                  <li>Sign an attestation with your PGP key</li>
                  <li>Publish attestation to the rendezvous server</li>
                  <li>Encrypt all keys in your local vault</li>
                </ul>
              </div>

              <button
                onClick={handleGenerateIdentity}
                disabled={loading}
                className="w-full btn-primary flex items-center justify-center gap-2"
              >
                {loading ? 'Generating...' : 'Generate Identity & Publish'}
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Step 4: Recovery Code */}
          {step === 'recovery-code' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 mb-2">
                <Key className="w-5 h-5 text-yellow-400" />
                <h2 className="text-lg font-semibold text-white">Save Your Recovery Code</h2>
              </div>

              <div className="bg-yellow-900/20 border border-yellow-700/50 rounded-lg p-4">
                <div className="flex items-start gap-2">
                  <AlertTriangle className="w-5 h-5 text-yellow-400 mt-0.5 flex-shrink-0" />
                  <div className="text-sm text-yellow-200">
                    <p className="font-medium">Store this offline. Write it down.</p>
                    <p className="mt-1 text-yellow-300/70">
                      If you lose all your devices, this code plus your PGP private key are the only
                      way to recover your account. There is no backdoor.
                    </p>
                  </div>
                </div>
              </div>

              <div className="bg-slate-900 rounded-lg p-4 font-mono text-sm text-primary-300
                              break-all leading-relaxed select-all border border-slate-700">
                {recoveryCode}
              </div>

              <button
                onClick={handleCopyRecovery}
                className="w-full btn-secondary flex items-center justify-center gap-2"
              >
                <Copy className="w-4 h-4" />
                {recoveryCopied ? 'Copied!' : 'Copy to Clipboard'}
              </button>

              <button
                onClick={handleComplete}
                className="w-full btn-primary flex items-center justify-center gap-2"
              >
                I&apos;ve saved my recovery code
                <CheckCircle className="w-4 h-4" />
              </button>
            </div>
          )}

          {/* Error display */}
          {error && (
            <div className="mt-4 flex items-center gap-2 text-red-400 text-sm bg-red-900/20
                            rounded-lg p-3">
              <AlertTriangle className="w-4 h-4 flex-shrink-0" />
              {error}
            </div>
          )}
        </div>

        {/* Step labels */}
        <div className="flex justify-between mt-4 px-2">
          {steps.map((s, i) => (
            <span
              key={s.key}
              className={`text-xs ${
                i <= currentStepIndex ? 'text-primary-400' : 'text-slate-600'
              }`}
            >
              {s.label}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
