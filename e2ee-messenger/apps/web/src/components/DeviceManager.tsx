'use client';

import { Smartphone, Trash2, Plus, Shield, Clock } from 'lucide-react';
import { type Device } from '@/lib/store';

interface DeviceManagerProps {
  devices: Device[];
  currentDeviceId: string;
  onRevoke: (deviceId: string) => void;
}

export function DeviceManager({ devices, currentDeviceId, onRevoke }: DeviceManagerProps) {
  const currentDevice: Device = devices.find(d => d.deviceId === currentDeviceId) || {
    deviceId: currentDeviceId,
    name: 'This Device',
    createdAt: Date.now(),
    isCurrentDevice: true,
  };

  const otherDevices = devices.filter(d => d.deviceId !== currentDeviceId);

  return (
    <div className="p-4 space-y-4">
      {/* Current device */}
      <div>
        <h3 className="text-xs font-medium text-[rgb(var(--color-text-secondary))] uppercase tracking-wider mb-2">
          Current Device
        </h3>
        <div className="card flex items-center gap-3">
          <div className="p-2 rounded-lg bg-primary-100 dark:bg-primary-900/30">
            <Smartphone className="w-5 h-5 text-primary-600 dark:text-primary-400" />
          </div>
          <div className="flex-1">
            <p className="text-sm font-medium">{currentDevice.name}</p>
            <p className="text-xs text-[rgb(var(--color-text-secondary))] font-mono">
              {currentDevice.deviceId}
            </p>
          </div>
          <div className="badge-connected flex items-center gap-1">
            <Shield className="w-3 h-3" />
            Active
          </div>
        </div>
      </div>

      {/* Other devices */}
      <div>
        <h3 className="text-xs font-medium text-[rgb(var(--color-text-secondary))] uppercase tracking-wider mb-2">
          Other Devices ({otherDevices.length})
        </h3>

        {otherDevices.length === 0 ? (
          <p className="text-sm text-[rgb(var(--color-text-secondary))] py-4 text-center">
            No other devices registered.
          </p>
        ) : (
          <div className="space-y-2">
            {otherDevices.map(device => (
              <div key={device.deviceId} className="card flex items-center gap-3">
                <div className="p-2 rounded-lg bg-[rgb(var(--color-bg))]">
                  <Smartphone className="w-5 h-5 text-[rgb(var(--color-text-secondary))]" />
                </div>
                <div className="flex-1">
                  <p className="text-sm font-medium">{device.name}</p>
                  <div className="flex items-center gap-2 text-xs text-[rgb(var(--color-text-secondary))]">
                    <Clock className="w-3 h-3" />
                    {device.lastActive
                      ? `Last active ${new Date(device.lastActive).toLocaleDateString()}`
                      : 'Never active'}
                  </div>
                </div>
                <button
                  onClick={() => {
                    if (confirm(`Revoke device "${device.name}"? This device will no longer be able to send or receive messages.`)) {
                      onRevoke(device.deviceId);
                    }
                  }}
                  className="p-2 rounded-lg hover:bg-red-50 dark:hover:bg-red-950/20 transition-colors"
                  title="Revoke device"
                >
                  <Trash2 className="w-4 h-4 text-red-500" />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Add device */}
      <div className="pt-2">
        <button className="w-full btn-secondary text-sm flex items-center justify-center gap-2">
          <Plus className="w-4 h-4" />
          Authorize New Device
        </button>
        <p className="text-xs text-[rgb(var(--color-text-secondary))] mt-2 text-center">
          New devices must be authorized from an existing device via QR code or signed token.
        </p>
      </div>

      {/* Security info */}
      <div className="card bg-primary-50 dark:bg-primary-950/20 border-primary-200 dark:border-primary-800">
        <div className="flex items-start gap-2">
          <Shield className="w-4 h-4 text-primary-500 mt-0.5 flex-shrink-0" />
          <div className="text-xs text-primary-700 dark:text-primary-300 space-y-1">
            <p className="font-medium">Multi-Device Security</p>
            <p>Each device has its own key pair and pre-keys. Revoking a device publishes
               a PGP-signed revocation statement. Messages sent after revocation cannot be
               decrypted by the revoked device.</p>
          </div>
        </div>
      </div>
    </div>
  );
}
