'use client';

import { useState, useCallback } from 'react';
import { useDevices } from '@/lib/hooks';
import { api } from '@/lib/api';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import Modal from '@/components/ui/Modal';
import DeviceCard from '@/components/devices/DeviceCard';
import {
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Key,
  Shield,
  Copy,
} from 'lucide-react';

export default function DevicesPage() {
  const { devices, loading, refresh } = useDevices();
  const [revokeTarget, setRevokeTarget] = useState<string | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [showBreakGlass, setShowBreakGlass] = useState(false);
  const [recoveryCodes, setRecoveryCodes] = useState<string[] | null>(null);
  const [generatingCodes, setGeneratingCodes] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);

  const handleRevoke = useCallback(
    async (deviceId: string) => {
      setRevoking(true);
      await api.devices.revoke(deviceId);
      setRevokeTarget(null);
      setRevoking(false);
      refresh();
    },
    [refresh]
  );

  const handleReenroll = useCallback(
    async (deviceId: string) => {
      await api.devices.reenroll(deviceId);
      refresh();
    },
    [refresh]
  );

  const handleGenerateRecovery = useCallback(async () => {
    setGeneratingCodes(true);
    const { data } = await api.devices.generateRecovery();
    if (data) setRecoveryCodes(data.codes);
    setGeneratingCodes(false);
  }, []);

  const copyCode = useCallback((code: string, index: number) => {
    navigator.clipboard.writeText(code);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
          Devices
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Manage enrolled devices and passkey bindings.
        </p>
      </div>

      {/* Device list */}
      {loading ? (
        <div className="flex items-center justify-center py-16">
          <div className="h-5 w-5 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
        </div>
      ) : devices.length === 0 ? (
        <Card>
          <p className="py-8 text-center text-sm text-text-muted">
            No devices enrolled.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
          {devices.map((device) => (
            <DeviceCard
              key={device.id}
              device={device}
              onRevoke={() => setRevokeTarget(device.id)}
              onReenroll={() => handleReenroll(device.id)}
            />
          ))}
        </div>
      )}

      {/* Break-glass recovery */}
      <div className="rounded-lg border border-accent-red/20">
        <button
          onClick={() => setShowBreakGlass(!showBreakGlass)}
          className="flex w-full items-center justify-between p-4 text-left"
        >
          <div className="flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-accent-red" />
            <div>
              <p className="text-sm font-medium text-accent-red">
                Break-Glass Recovery
              </p>
              <p className="text-xs text-text-muted">
                Emergency access when all devices are unavailable.
              </p>
            </div>
          </div>
          {showBreakGlass ? (
            <ChevronDown className="h-4 w-4 text-text-muted" />
          ) : (
            <ChevronRight className="h-4 w-4 text-text-muted" />
          )}
        </button>

        {showBreakGlass && (
          <div className="border-t border-accent-red/20 p-4">
            <div className="mb-4 rounded-lg border border-accent-amber/20 bg-accent-amber/5 p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-amber" />
                <p className="text-sm text-accent-amber">
                  Recovery codes provide emergency access. Store them in a
                  secure, offline location. Each code can only be used once.
                  Generating new codes invalidates all previous codes.
                </p>
              </div>
            </div>

            {recoveryCodes ? (
              <div className="space-y-3">
                <p className="text-sm font-medium text-text-primary">
                  Recovery Codes
                </p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {recoveryCodes.map((code, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between rounded-lg border border-border bg-surface p-2"
                    >
                      <code className="font-mono text-sm text-text-primary">
                        {code}
                      </code>
                      <button
                        onClick={() => copyCode(code, i)}
                        className="ml-2 text-text-muted transition-colors hover:text-text-primary"
                      >
                        {copiedIndex === i ? (
                          <span className="text-xs text-accent-green">
                            Copied
                          </span>
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    </div>
                  ))}
                </div>
                <p className="text-xs text-accent-red">
                  These codes will not be shown again. Save them now.
                </p>
              </div>
            ) : (
              <Button
                variant="danger"
                onClick={handleGenerateRecovery}
                loading={generatingCodes}
              >
                <Key className="mr-1.5 h-4 w-4" />
                Generate Recovery Codes
              </Button>
            )}
          </div>
        )}
      </div>

      {/* Revoke confirmation modal */}
      {revokeTarget && (
        <Modal
          title="Revoke Device"
          onClose={() => setRevokeTarget(null)}
          actions={
            <>
              <Button
                variant="ghost"
                onClick={() => setRevokeTarget(null)}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                onClick={() => handleRevoke(revokeTarget)}
                loading={revoking}
              >
                Revoke Device
              </Button>
            </>
          }
        >
          <div className="space-y-3">
            <p className="text-sm text-text-secondary">
              Revoking this device will immediately invalidate its passkey and
              terminate any active sessions. This action is logged and cannot be
              undone.
            </p>
            <div className="flex items-start gap-2 rounded-lg border border-accent-amber/20 bg-accent-amber/5 p-3">
              <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-accent-amber" />
              <p className="text-sm text-accent-amber">
                If this is your only enrolled device, you will need recovery
                codes to regain access.
              </p>
            </div>
          </div>
        </Modal>
      )}
    </div>
  );
}
