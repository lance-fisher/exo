'use client';

import type { Device } from '@/lib/api';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import {
  Laptop,
  Smartphone,
  Monitor,
  Tablet,
  Key,
  Shield,
  AlertTriangle,
  Clock,
  MoreVertical,
} from 'lucide-react';

interface DeviceCardProps {
  device: Device;
  onRevoke: () => void;
  onReenroll: () => void;
}

const deviceIcons: Record<string, typeof Laptop> = {
  laptop: Laptop,
  iphone: Smartphone,
  desktop: Monitor,
  tablet: Tablet,
};

export default function DeviceCard({
  device,
  onRevoke,
  onReenroll,
}: DeviceCardProps) {
  const Icon = deviceIcons[device.type] || Monitor;

  return (
    <Card>
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface">
              <Icon className="h-5 w-5 text-text-secondary" />
            </div>
            <div>
              <p className="text-sm font-medium text-text-primary">
                {device.name}
              </p>
              <p className="text-xs capitalize text-text-muted">
                {device.type}
              </p>
            </div>
          </div>
          <Badge
            variant={
              device.status === 'enrolled'
                ? 'success'
                : device.status === 'revoked'
                ? 'danger'
                : 'warning'
            }
          >
            {device.status}
          </Badge>
        </div>

        {/* Details */}
        <div className="space-y-2 text-xs">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Key className="h-3 w-3" />
              Passkey
            </div>
            <span className="text-text-secondary">
              {device.passkeyBound ? 'Bound' : 'Not bound'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Shield className="h-3 w-3" />
              Platform
            </div>
            <span className="text-text-secondary">
              {device.platformBinding || 'Unknown'}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Clock className="h-3 w-3" />
              Enrolled
            </div>
            <span className="text-text-secondary">
              {new Date(device.enrolledAt).toLocaleDateString()}
            </span>
          </div>

          <div className="flex items-center justify-between">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Clock className="h-3 w-3" />
              Last seen
            </div>
            <span className="text-text-secondary">
              {device.lastSeen ? new Date(device.lastSeen).toLocaleString() : 'Never'}
            </span>
          </div>
        </div>

        {/* Risk flags */}
        {device.riskFlags.length > 0 && (
          <div className="space-y-1.5">
            {device.riskFlags.map((flag, i) => (
              <div
                key={i}
                className="flex items-center gap-1.5 rounded-lg border border-accent-amber/20 bg-accent-amber/5 px-2 py-1"
              >
                <AlertTriangle className="h-3 w-3 text-accent-amber" />
                <span className="text-xs text-accent-amber">{flag}</span>
              </div>
            ))}
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 pt-1">
          {device.status === 'enrolled' && (
            <Button
              variant="danger"
              size="sm"
              className="flex-1"
              onClick={onRevoke}
            >
              Revoke
            </Button>
          )}
          {device.status === 'revoked' && (
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={onReenroll}
            >
              Re-enroll
            </Button>
          )}
        </div>
      </div>
    </Card>
  );
}
