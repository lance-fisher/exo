'use client';

import { useState, useEffect, useCallback } from 'react';
import { api, type Task, type Project } from '@/lib/api';
import { useAgentStatus, useTokenUsage, useTaskStream } from '@/lib/hooks';
import TaskComposer from '@/components/tasks/TaskComposer';
import TaskOutput from '@/components/tasks/TaskOutput';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import Button from '@/components/ui/Button';
import ApprovalModal from '@/components/approval/ApprovalModal';
import { Layers, Play, Square } from 'lucide-react';

export default function TasksPage() {
  const { status } = useAgentStatus();
  const { usage, refresh: refreshUsage } = useTokenUsage();
  const [projects, setProjects] = useState<Project[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null);
  const [approvalId, setApprovalId] = useState<string | null>(null);
  const { events, output, streaming, error: streamError, tokensUsed } =
    useTaskStream(activeTaskId);

  useEffect(() => {
    api.system.projects().then(({ data }) => {
      if (data) setProjects(data);
    });
    api.tasks.list().then(({ data }) => {
      if (data) setTasks(data);
    });
  }, []);

  const handleSubmitTask = useCallback(
    async (task: {
      projectId: string;
      type: Task['type'];
      description: string;
      contextFiles?: string[];
      tokenBudget?: number;
    }) => {
      const { data, error } = await api.tasks.create(task);
      if (error) {
        throw new Error(error);
      }
      if (data) {
        setActiveTaskId(data.id);
        setTasks((prev) => [{ ...data, type: task.type, queued_at: new Date().toISOString(), createdAt: new Date().toISOString(), completed_at: null } as Task, ...prev]);
        refreshUsage();
      }
    },
    [refreshUsage]
  );

  const handleCancelTask = useCallback(async () => {
    if (!activeTaskId) return;
    await api.tasks.cancel(activeTaskId);
    setActiveTaskId(null);
  }, [activeTaskId]);

  // Check for approval requirement from stream events
  useEffect(() => {
    const approvalEvent = events.find(
      (e) => e.type === 'result' && typeof e.data.message === 'string' && (e.data.message as string).includes('approval_required:')
    );
    if (approvalEvent && typeof approvalEvent.data.message === 'string') {
      const id = (approvalEvent.data.message as string).split('approval_required:')[1]?.trim();
      if (id) setApprovalId(id);
    }
  }, [events]);

  const agentOnline = status?.agentOnline ?? false;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-text-primary">
            Tasks
          </h1>
          <p className="mt-1 text-sm text-text-secondary">
            Compose and monitor agent tasks.
          </p>
        </div>
        <div className="flex items-center gap-3">
          {usage && (
            <span className="text-xs text-text-muted">
              Session: {usage.sessionTotal.toLocaleString()} tokens
            </span>
          )}
          <Badge variant={agentOnline ? 'success' : 'danger'} dot>
            Agent {agentOnline ? 'Online' : 'Offline'}
          </Badge>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        {/* Left panel: Composer */}
        <div className="space-y-4">
          <TaskComposer
            projects={projects}
            agentOnline={agentOnline}
            onSubmit={handleSubmitTask}
            disabled={streaming}
          />

          {/* Task history */}
          <Card
            header={
              <div className="flex items-center gap-2">
                <Layers className="h-4 w-4 text-text-muted" />
                <span className="text-sm font-medium text-text-primary">
                  Recent Tasks
                </span>
              </div>
            }
          >
            {tasks.length === 0 ? (
              <p className="text-sm text-text-muted">No tasks yet.</p>
            ) : (
              <div className="space-y-2">
                {tasks.slice(0, 10).map((task) => (
                  <button
                    key={task.id}
                    onClick={() => setActiveTaskId(task.id)}
                    className="flex w-full items-center justify-between rounded-lg border border-border bg-surface p-3 text-left transition-colors hover:border-border-hover"
                  >
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm text-text-primary">
                        {task.description ?? task.type}
                      </p>
                      <p className="mt-0.5 text-xs text-text-muted">
                        {task.type} &middot;{' '}
                        {new Date(task.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <Badge
                      variant={
                        task.status === 'completed'
                          ? 'success'
                          : task.status === 'failed'
                          ? 'danger'
                          : task.status === 'running'
                          ? 'info'
                          : 'neutral'
                      }
                    >
                      {task.status}
                    </Badge>
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        {/* Right panel: Output */}
        <div className="space-y-4">
          {activeTaskId ? (
            <>
              <Card>
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    {streaming && (
                      <div className="h-2 w-2 animate-pulse rounded-full bg-accent-blue" />
                    )}
                    <span className="text-sm font-medium text-text-primary">
                      {streaming ? 'Running' : 'Complete'}
                    </span>
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-text-muted">
                      {tokensUsed.toLocaleString()} tokens
                    </span>
                    {streaming && (
                      <Button
                        variant="danger"
                        size="sm"
                        onClick={handleCancelTask}
                      >
                        <Square className="mr-1 h-3 w-3" />
                        Stop
                      </Button>
                    )}
                  </div>
                </div>
              </Card>
              <TaskOutput
                output={output}
                events={events}
                streaming={streaming}
                error={streamError}
                tokensUsed={tokensUsed}
              />
            </>
          ) : (
            <Card>
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <Play className="mb-3 h-8 w-8 text-text-muted" />
                <p className="text-sm text-text-secondary">
                  Submit a task to see output here.
                </p>
              </div>
            </Card>
          )}
        </div>
      </div>

      {approvalId && (
        <ApprovalModal
          approvalId={approvalId}
          onClose={() => setApprovalId(null)}
        />
      )}
    </div>
  );
}
