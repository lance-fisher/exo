import React from 'react';
import type { Task } from '../utils/api';

interface TaskListProps {
  tasks: Task[];
  onSelect: (id: string) => void;
}

export function TaskList({ tasks, onSelect }: TaskListProps) {
  if (tasks.length === 0) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 32 }}>
        <p style={{ color: 'var(--text-muted)' }}>No tasks yet. Submit one above to get started.</p>
      </div>
    );
  }

  return (
    <div>
      <h2 style={{ fontSize: '1.125rem', marginBottom: 12 }}>Recent Tasks</h2>
      <div className="task-list" role="list" aria-label="Task list">
        {tasks.map(task => (
          <div
            key={task.id}
            className="card task-item"
            role="listitem"
            tabIndex={0}
            onClick={() => onSelect(task.id)}
            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onSelect(task.id); } }}
            aria-label={`Task: ${task.user_request}. Status: ${task.status}`}
          >
            <div className="task-item-header">
              <span className="task-item-request">{task.user_request}</span>
              <span className={`badge badge-${task.status}`}>{task.status}</span>
              <span className="task-item-time">
                {new Date(task.created_at).toLocaleTimeString()}
              </span>
            </div>
            {task.interpreted_objective && (
              <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginTop: 4 }}>
                {task.interpreted_objective}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
