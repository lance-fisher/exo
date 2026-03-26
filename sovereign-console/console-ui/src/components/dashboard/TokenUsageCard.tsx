'use client';

import { useState } from 'react';
import type { TokenUsage } from '@/lib/api';
import Card from '@/components/ui/Card';
import { Coins, ChevronDown, ChevronRight, AlertTriangle } from 'lucide-react';

interface TokenUsageCardProps {
  usage: TokenUsage | null;
}

export default function TokenUsageCard({ usage }: TokenUsageCardProps) {
  const [expanded, setExpanded] = useState(false);

  if (!usage) {
    return (
      <Card
        header={
          <div className="flex items-center gap-2">
            <Coins className="h-4 w-4 text-text-muted" />
            <span className="text-sm font-medium text-text-primary">
              Token Usage
            </span>
          </div>
        }
      >
        <p className="text-sm text-text-muted">Loading usage data...</p>
      </Card>
    );
  }

  const usagePercent =
    usage.budgetLimit > 0
      ? Math.min(100, (usage.dailyTotal / usage.budgetLimit) * 100)
      : 0;
  const nearLimit = usagePercent >= 80;

  return (
    <Card
      header={
        <div className="flex items-center gap-2">
          <Coins className="h-4 w-4 text-text-muted" />
          <span className="text-sm font-medium text-text-primary">
            Token Usage
          </span>
          {nearLimit && (
            <AlertTriangle className="h-3.5 w-3.5 text-accent-amber" />
          )}
        </div>
      }
    >
      <div className="space-y-4">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-4">
          <div>
            <p className="text-xs text-text-muted">Session</p>
            <p className="mt-0.5 text-lg font-semibold text-text-primary">
              {usage.sessionTotal.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Daily</p>
            <p className="mt-0.5 text-lg font-semibold text-text-primary">
              {usage.dailyTotal.toLocaleString()}
            </p>
          </div>
          <div>
            <p className="text-xs text-text-muted">Remaining</p>
            <p className="mt-0.5 text-lg font-semibold text-text-primary">
              {usage.budgetRemaining.toLocaleString()}
            </p>
          </div>
        </div>

        {/* Progress bar */}
        <div>
          <div className="mb-1 flex items-center justify-between text-xs text-text-muted">
            <span>Daily budget</span>
            <span>{Math.round(usagePercent)}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface">
            <div
              className={`h-full rounded-full transition-all ${
                nearLimit ? 'bg-accent-amber' : 'bg-accent-blue'
              }`}
              style={{ width: `${usagePercent}%` }}
            />
          </div>
          {nearLimit && (
            <p className="mt-1 text-xs text-accent-amber">
              Approaching daily token limit.
            </p>
          )}
        </div>

        {/* Per-task breakdown */}
        {usage.perTask.length > 0 && (
          <div>
            <button
              onClick={() => setExpanded(!expanded)}
              className="flex items-center gap-1 text-xs text-text-muted hover:text-text-secondary"
            >
              {expanded ? (
                <ChevronDown className="h-3 w-3" />
              ) : (
                <ChevronRight className="h-3 w-3" />
              )}
              Per-task breakdown ({usage.perTask.length})
            </button>

            {expanded && (
              <div className="mt-2 space-y-1.5">
                {usage.perTask.map((task) => (
                  <div
                    key={task.taskId}
                    className="flex items-center justify-between rounded-lg border border-border bg-surface px-3 py-1.5"
                  >
                    <span className="truncate text-xs text-text-secondary">
                      {task.description}
                    </span>
                    <span className="ml-2 flex-shrink-0 text-xs font-medium text-text-primary">
                      {task.tokens.toLocaleString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
