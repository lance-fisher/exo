'use client';

import { useState, useEffect } from 'react';
import {
  useSession,
  useAgentStatus,
  useTokenUsage,
  usePendingApprovals,
} from '@/lib/hooks';
import { api, type AuditEntry } from '@/lib/api';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import AgentStatusCard from '@/components/dashboard/AgentStatusCard';
import TokenUsageCard from '@/components/dashboard/TokenUsageCard';
import {
  Activity,
  Clock,
  CheckCircle,
  AlertCircle,
  FileText,
  Zap,
} from 'lucide-react';

export default function DashboardPage() {
  const { session } = useSession();
  const { status } = useAgentStatus();
  const { usage } = useTokenUsage();
  const { approvals } = usePendingApprovals();
  const [recentActivity, setRecentActivity] = useState<AuditEntry[]>([]);
  const [tasksToday, setTasksToday] = useState(0);

  useEffect(() => {
    api.audit
      .list({ page: 1, pageSize: 5 })
      .then(({ data }) => {
        if (data) setRecentActivity(data.entries);
      });

    const today = new Date().toISOString().split('T')[0];
    api.tasks.list().then(({ data }) => {
      if (data) {
        const todayTasks = data.filter((t) =>
          t.createdAt.startsWith(today)
        );
        setTasksToday(todayTasks.length);
      }
    });
  }, []);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
          Sovereign Console
        </h1>
        <p className="mt-1 text-sm text-text-secondary">
          Operations overview and system status.
        </p>
      </div>

      {/* Status cards row */}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        <AgentStatusCard status={status} />

        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                Active Session
              </p>
              <p className="mt-2 text-lg font-semibold text-text-primary">
                {session?.deviceName || 'Unknown'}
              </p>
              <p className="mt-1 text-xs text-text-secondary">
                Expires{' '}
                {session?.expiresAt
                  ? new Date(session.expiresAt).toLocaleTimeString()
                  : '--'}
              </p>
            </div>
            <Clock className="h-5 w-5 text-text-muted" />
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                Tasks Today
              </p>
              <p className="mt-2 text-2xl font-semibold text-text-primary">
                {tasksToday}
              </p>
            </div>
            <Zap className="h-5 w-5 text-text-muted" />
          </div>
        </Card>

        <Card>
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-medium uppercase tracking-wider text-text-muted">
                Pending Approvals
              </p>
              <p className="mt-2 text-2xl font-semibold text-text-primary">
                {approvals.length}
              </p>
            </div>
            {approvals.length > 0 ? (
              <AlertCircle className="h-5 w-5 text-accent-amber" />
            ) : (
              <CheckCircle className="h-5 w-5 text-accent-green" />
            )}
          </div>
        </Card>
      </div>

      {/* Token usage and recent activity */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <TokenUsageCard usage={usage} />

        <Card
          header={
            <div className="flex items-center gap-2">
              <Activity className="h-4 w-4 text-text-muted" />
              <span className="text-sm font-medium text-text-primary">
                Recent Activity
              </span>
            </div>
          }
        >
          {recentActivity.length === 0 ? (
            <p className="text-sm text-text-muted">No recent activity.</p>
          ) : (
            <div className="space-y-3">
              {recentActivity.map((entry) => (
                <div
                  key={entry.id}
                  className="flex items-start gap-3 border-b border-border pb-3 last:border-0 last:pb-0"
                >
                  <FileText className="mt-0.5 h-4 w-4 flex-shrink-0 text-text-muted" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-text-primary">
                      {entry.action}
                    </p>
                    <div className="mt-1 flex items-center gap-2">
                      <span className="text-xs text-text-muted">
                        {new Date(entry.timestamp).toLocaleString()}
                      </span>
                      <Badge variant="neutral" className="text-[10px]">
                        {entry.eventType}
                      </Badge>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>

      {/* Queued commands */}
      {status && status.queuedCommands > 0 && (
        <Card
          header={
            <div className="flex items-center gap-2">
              <AlertCircle className="h-4 w-4 text-accent-amber" />
              <span className="text-sm font-medium text-text-primary">
                Queued Commands
              </span>
              <Badge variant="warning">{status.queuedCommands}</Badge>
            </div>
          }
        >
          <p className="text-sm text-text-secondary">
            {status.queuedCommands} command(s) are queued and awaiting
            reconfirmation or agent availability.
          </p>
        </Card>
      )}
    </div>
  );
}
