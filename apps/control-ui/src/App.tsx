import React, { useState, useEffect, useCallback } from 'react';
import { TaskForm } from './components/TaskForm';
import { TaskList } from './components/TaskList';
import { TaskDetail } from './components/TaskDetail';
import { useWebSocket } from './hooks/useWebSocket';
import { api, Task, Subtask } from './utils/api';

type ViewMode = 'simple' | 'advanced';
type Theme = 'light' | 'dark' | 'high-contrast';

export function App() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [selectedTask, setSelectedTask] = useState<{ task: Task; subtasks: Subtask[] } | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>('simple');
  const [theme, setTheme] = useState<Theme>('light');
  const [error, setError] = useState<string | null>(null);

  const { connected, events, subscribe } = useWebSocket();

  // Apply theme
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? '' : theme);
  }, [theme]);

  // Load tasks
  const loadTasks = useCallback(async () => {
    try {
      const result = await api.listTasks();
      setTasks(result.tasks);
    } catch (err) {
      // API not available yet - that is OK during startup
      console.log('API not available yet');
    }
  }, []);

  useEffect(() => {
    loadTasks();
    const interval = setInterval(loadTasks, 5000);
    return () => clearInterval(interval);
  }, [loadTasks]);

  // Load selected task detail
  useEffect(() => {
    if (!selectedTaskId) {
      setSelectedTask(null);
      return;
    }
    subscribe(selectedTaskId);
    const loadDetail = async () => {
      try {
        const result = await api.getTask(selectedTaskId);
        setSelectedTask({ task: result.task, subtasks: result.subtasks });
      } catch {
        // ignore
      }
    };
    loadDetail();
    const interval = setInterval(loadDetail, 3000);
    return () => clearInterval(interval);
  }, [selectedTaskId, subscribe]);

  // Refresh on WS events
  useEffect(() => {
    if (events.length > 0) {
      const lastEvent = events[events.length - 1];
      if (lastEvent.task_id === selectedTaskId) {
        api.getTask(selectedTaskId!).then(result => {
          setSelectedTask({ task: result.task, subtasks: result.subtasks });
        }).catch(() => {});
      }
      loadTasks();
    }
  }, [events, selectedTaskId, loadTasks]);

  const handleSubmitTask = async (request: string) => {
    try {
      setError(null);
      const result = await api.submitTask(request);
      setSelectedTaskId(result.id);
      await loadTasks();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to submit task');
    }
  };

  const handleApprove = async (subtaskId: string) => {
    if (!selectedTaskId) return;
    try {
      await api.approve(selectedTaskId, subtaskId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to approve');
    }
  };

  const taskEvents = events.filter(e => e.task_id === selectedTaskId);

  return (
    <div className="app">
      <a href="#main-content" className="skip-link">Skip to main content</a>

      <header className="header" role="banner">
        <h1>Distributed Claude Agents</h1>
        <div className="header-controls">
          <div className="connection-status" aria-live="polite">
            <span
              className={`connection-dot ${connected ? 'connected' : 'disconnected'}`}
              aria-hidden="true"
            />
            <span>{connected ? 'Connected' : 'Disconnected'}</span>
          </div>

          <div className="mode-toggle" role="radiogroup" aria-label="View mode">
            <button
              className={viewMode === 'simple' ? 'active' : ''}
              onClick={() => setViewMode('simple')}
              role="radio"
              aria-checked={viewMode === 'simple'}
            >
              Simple
            </button>
            <button
              className={viewMode === 'advanced' ? 'active' : ''}
              onClick={() => setViewMode('advanced')}
              role="radio"
              aria-checked={viewMode === 'advanced'}
            >
              Advanced
            </button>
          </div>

          <select
            value={theme}
            onChange={e => setTheme(e.target.value as Theme)}
            className="btn btn-sm"
            aria-label="Color theme"
          >
            <option value="light">Light</option>
            <option value="dark">Dark</option>
            <option value="high-contrast">High Contrast</option>
          </select>
        </div>
      </header>

      <main id="main-content" className="main-content" role="main">
        <TaskForm onSubmit={handleSubmitTask} />

        {error && (
          <div role="alert" className="card" style={{ borderColor: 'var(--danger)', marginBottom: 16 }}>
            <p style={{ color: 'var(--danger)' }}>{error}</p>
          </div>
        )}

        {selectedTask ? (
          <div>
            <button
              className="btn btn-sm"
              onClick={() => setSelectedTaskId(null)}
              style={{ marginBottom: 16 }}
            >
              Back to task list
            </button>
            <TaskDetail
              task={selectedTask.task}
              subtasks={selectedTask.subtasks}
              events={taskEvents}
              viewMode={viewMode}
              onApprove={handleApprove}
            />
          </div>
        ) : (
          <TaskList tasks={tasks} onSelect={setSelectedTaskId} />
        )}
      </main>

      <footer style={{ padding: '12px 24px', textAlign: 'center', color: 'var(--text-muted)', fontSize: '0.8125rem' }}>
        Distributed Claude Agents v0.1.0 - Local-first multi-agent task system
      </footer>
    </div>
  );
}
