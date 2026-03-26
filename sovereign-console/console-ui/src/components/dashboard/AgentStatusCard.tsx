'use client';

import type { SystemStatus } from '@/lib/api';
import Card from '@/components/ui/Card';
import { clsx } from 'clsx';
import { Cpu, Wifi, WifiOff } from 'lucide-react';

interface AgentStatusCardProps {
  status: SystemStatus | null;
}

export default function AgentStatusCard({ status }: AgentStatusCardProps) {
  const online = status?.agentOnline ?? false;

  return (
    <Card>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
            Agent
          </p>
          <div className="mt-2 flex items-center gap-2">
            <div
              className={clsx(
                'h-2.5 w-2.5 rounded-full',
                online
                  ? 'bg-accent-green animate-pulse-slow'
                  : 'bg-text-muted'
              )}
            />
            <span
              className={clsx(
                'text-lg font-semibold',
                online ? 'text-accent-green' : 'text-text-muted'
              )}
            >
              {online ? 'Online' : 'Offline'}
            </span>
          </div>
          {status?.agentLastSeen && (
            <p className="mt-1 text-xs text-text-muted">
              Last seen: {new Date(status.agentLastSeen).toLocaleString()}
            </p>
          )}
          {status && status.queuedCommands > 0 && (
            <p className="mt-0.5 text-xs text-accent-amber">
              {status.queuedCommands} queued
            </p>
          )}
        </div>
        {online ? (
          <Wifi className="h-5 w-5 text-accent-green" />
        ) : (
          <WifiOff className="h-5 w-5 text-text-muted" />
        )}
      </div>
    </Card>
  );
}
