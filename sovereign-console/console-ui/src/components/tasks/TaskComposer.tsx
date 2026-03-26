'use client';

import { useState, useCallback } from 'react';
import { api, type Task, type Project } from '@/lib/api';
import Card from '@/components/ui/Card';
import Button from '@/components/ui/Button';
import Input from '@/components/ui/Input';
import Badge from '@/components/ui/Badge';
import { Send, Coins, AlertCircle } from 'lucide-react';

interface TaskComposerProps {
  projects: Project[];
  agentOnline: boolean;
  onSubmit: (task: {
    projectId: string;
    type: Task['type'];
    description: string;
    contextFiles?: string[];
    tokenBudget?: number;
  }) => Promise<void>;
  disabled?: boolean;
}

const TASK_TYPES: { value: Task['type']; label: string }[] = [
  { value: 'review', label: 'Review' },
  { value: 'edit', label: 'Edit' },
  { value: 'analyze', label: 'Analyze' },
  { value: 'execute', label: 'Execute' },
];

export default function TaskComposer({
  projects,
  agentOnline,
  onSubmit,
  disabled,
}: TaskComposerProps) {
  const [projectId, setProjectId] = useState(projects[0]?.id || '');
  const [taskType, setTaskType] = useState<Task['type']>('review');
  const [description, setDescription] = useState('');
  const [contextFiles, setContextFiles] = useState('');
  const [tokenEstimate, setTokenEstimate] = useState<number | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Update project when projects load
  if (projects.length > 0 && !projectId) {
    setProjectId(projects[0].id);
  }

  const handleEstimate = useCallback(async () => {
    if (!description.trim()) return;
    const { data } = await api.tasks.estimateTokens(description);
    if (data) setTokenEstimate(data.estimated);
  }, [description]);

  const handleSubmit = useCallback(async () => {
    if (!description.trim() || !projectId) return;
    setSubmitting(true);
    setError(null);

    try {
      const files = contextFiles
        .split('\n')
        .map((f) => f.trim())
        .filter(Boolean);
      await onSubmit({
        projectId,
        type: taskType,
        description: description.trim(),
        contextFiles: files.length > 0 ? files : undefined,
      });
      setDescription('');
      setContextFiles('');
      setTokenEstimate(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit task.');
    } finally {
      setSubmitting(false);
    }
  }, [description, projectId, taskType, contextFiles, onSubmit]);

  const isDisabled = disabled || submitting || !agentOnline;

  return (
    <Card
      header={
        <span className="text-sm font-medium text-text-primary">
          Compose Task
        </span>
      }
    >
      <div className="space-y-4">
        {/* Project selector */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            Project
          </label>
          <select
            value={projectId}
            onChange={(e) => setProjectId(e.target.value)}
            className="w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary focus:border-accent-blue focus:outline-none"
            disabled={isDisabled}
          >
            {projects.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
            {projects.length === 0 && (
              <option value="">No projects</option>
            )}
          </select>
        </div>

        {/* Task type */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            Task Type
          </label>
          <div className="flex gap-2">
            {TASK_TYPES.map((t) => (
              <button
                key={t.value}
                onClick={() => setTaskType(t.value)}
                disabled={isDisabled}
                className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition-colors ${
                  taskType === t.value
                    ? 'border-accent-blue bg-accent-blue/10 text-accent-blue'
                    : 'border-border text-text-secondary hover:border-border-hover'
                } disabled:opacity-50`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {/* Description */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onBlur={handleEstimate}
            placeholder="Describe the task for the agent..."
            rows={4}
            disabled={isDisabled}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 text-sm text-text-primary placeholder-text-muted transition-colors focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue/50 disabled:opacity-50"
          />
        </div>

        {/* Context files */}
        <div>
          <label className="mb-1.5 block text-xs font-medium text-text-muted">
            Context Files (one per line, optional)
          </label>
          <textarea
            value={contextFiles}
            onChange={(e) => setContextFiles(e.target.value)}
            placeholder="src/main.ts&#10;src/utils/helper.ts"
            rows={2}
            disabled={isDisabled}
            className="w-full resize-none rounded-lg border border-border bg-surface px-3 py-2 font-mono text-xs text-text-primary placeholder-text-muted transition-colors focus:border-accent-blue focus:outline-none focus:ring-1 focus:ring-accent-blue/50 disabled:opacity-50"
          />
        </div>

        {/* Token estimate */}
        {tokenEstimate !== null && (
          <div className="flex items-center gap-2 rounded-lg border border-border bg-surface p-3">
            <Coins className="h-4 w-4 text-text-muted" />
            <span className="text-xs text-text-secondary">
              Estimated: {tokenEstimate.toLocaleString()} tokens
            </span>
          </div>
        )}

        {/* Error */}
        {error && (
          <div className="flex items-center gap-2 rounded-lg border border-accent-red/20 bg-accent-red/5 p-3">
            <AlertCircle className="h-4 w-4 text-accent-red" />
            <span className="text-sm text-accent-red">{error}</span>
          </div>
        )}

        {/* Submit */}
        <div className="relative">
          <Button
            variant="primary"
            className="w-full"
            onClick={handleSubmit}
            loading={submitting}
            disabled={isDisabled || !description.trim()}
          >
            <Send className="mr-1.5 h-4 w-4" />
            Submit Task
          </Button>
          {!agentOnline && (
            <p className="mt-1.5 text-center text-xs text-accent-amber">
              Agent is offline. Tasks cannot be submitted.
            </p>
          )}
        </div>
      </div>
    </Card>
  );
}
