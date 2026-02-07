import React from 'react';
import type { Task, Subtask } from '../utils/api';
import type { WSEvent } from '../hooks/useWebSocket';

interface TaskDetailProps {
  task: Task;
  subtasks: Subtask[];
  events: WSEvent[];
  viewMode: 'simple' | 'advanced';
  onApprove: (subtaskId: string) => void;
}

export function TaskDetail({ task, subtasks, events, viewMode, onApprove }: TaskDetailProps) {
  const pendingApprovals = subtasks.filter(s => s.status === 'awaiting_approval');

  return (
    <div aria-label={`Task detail: ${task.user_request}`}>
      {/* Header */}
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card-header">
          <h2>{task.user_request}</h2>
          <span className={`badge badge-${task.status}`}>{task.status}</span>
        </div>

        {task.interpreted_objective && (
          <p style={{ marginBottom: 8 }}>
            <strong>Objective:</strong> {task.interpreted_objective}
          </p>
        )}

        {task.assumptions.length > 0 && (
          <div style={{ marginBottom: 8 }}>
            <strong>Assumptions:</strong>
            <ul style={{ paddingLeft: 20, marginTop: 4 }}>
              {task.assumptions.map((a, i) => (
                <li key={i} style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>{a}</li>
              ))}
            </ul>
          </div>
        )}
      </div>

      {/* Approval banners */}
      {pendingApprovals.map(sub => (
        <div key={sub.id} className="approval-banner" role="alert" style={{ marginBottom: 16 }}>
          <div className="approval-banner-text">
            <strong>Approval needed:</strong> {sub.title}
            <br />
            <span style={{ fontSize: '0.875rem', color: 'var(--text-secondary)' }}>
              Risk level: <span className={`badge badge-${sub.risk_tier.toLowerCase()}`}>{sub.risk_tier}</span>
            </span>
            {sub.description && (
              <p style={{ fontSize: '0.875rem', marginTop: 4 }}>{sub.description}</p>
            )}
          </div>
          <div className="approval-actions">
            <button className="btn btn-primary" onClick={() => onApprove(sub.id)}>
              Approve
            </button>
          </div>
        </div>
      ))}

      <div className={viewMode === 'advanced' ? 'task-detail' : ''}>
        {/* Subtasks */}
        <div className={`card ${viewMode === 'advanced' ? '' : ''}`} style={{ marginBottom: 16 }}>
          <div className="card-header">
            <h3>Progress</h3>
            <span style={{ fontSize: '0.8125rem', color: 'var(--text-muted)' }}>
              {subtasks.filter(s => s.status === 'completed').length}/{subtasks.length} complete
            </span>
          </div>
          <div className="subtask-list" role="list" aria-label="Subtasks">
            {subtasks.map(sub => (
              <div key={sub.id} className="subtask-item" role="listitem">
                <span className="subtask-role">{formatRole(sub.assigned_role)}</span>
                <span className="subtask-title">{sub.title}</span>
                <span className={`badge badge-${sub.status}`}>{sub.status}</span>
                <span className={`badge badge-${sub.risk_tier.toLowerCase()}`}>{sub.risk_tier}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Speakable summary - always visible in simple mode */}
        {task.result_packet && (
          <div className="card" style={{ marginBottom: 16 }}>
            <div className="card-header">
              <h3>Summary</h3>
            </div>
            <div className="speakable-panel" aria-live="polite">
              <p>{task.result_packet.summary}</p>
            </div>
          </div>
        )}

        {/* Advanced mode panels */}
        {viewMode === 'advanced' && (
          <>
            {/* Plan */}
            {task.plan.length > 0 && (
              <div className="card" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <h3>Plan</h3>
                </div>
                <ol style={{ paddingLeft: 20 }}>
                  {task.plan.map((step, i) => (
                    <li key={i} style={{ marginBottom: 6, fontSize: '0.875rem' }}>
                      <strong>{step.title}</strong>
                      <span style={{ marginLeft: 8, fontSize: '0.75rem', color: 'var(--text-muted)' }}>
                        ({step.assigned_role})
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}

            {/* Events log */}
            <div className="card task-detail-full" style={{ marginBottom: 16 }}>
              <div className="card-header">
                <h3>Event Log</h3>
              </div>
              <div className="event-log" role="log" aria-label="Task event log" aria-live="polite">
                {events.length === 0 ? (
                  <p style={{ color: 'var(--text-muted)' }}>Waiting for events...</p>
                ) : (
                  events.map((event, i) => (
                    <div key={i} className="event-entry">
                      <span className="event-time">{formatTime(event.timestamp)}</span>
                      <span className="event-type">{event.type}</span>
                      <span>{formatEventPayload(event)}</span>
                    </div>
                  ))
                )}
              </div>
            </div>

            {/* Artifacts */}
            {subtasks.some(s => s.artifacts.length > 0) && (
              <div className="card task-detail-full" style={{ marginBottom: 16 }}>
                <div className="card-header">
                  <h3>Artifacts</h3>
                </div>
                {subtasks.filter(s => s.artifacts.length > 0).map(sub => (
                  <div key={sub.id} style={{ marginBottom: 12 }}>
                    <h4 style={{ fontSize: '0.875rem', fontWeight: 600, marginBottom: 4 }}>
                      {formatRole(sub.assigned_role)}: {sub.title}
                    </h4>
                    {sub.artifacts.map((art, i) => (
                      <details key={i} style={{ marginBottom: 4 }}>
                        <summary style={{ cursor: 'pointer', fontSize: '0.8125rem' }}>
                          {art.name} ({art.type})
                        </summary>
                        <pre className="diff-viewer">{art.content}</pre>
                      </details>
                    ))}
                  </div>
                ))}
              </div>
            )}

            {/* Result packet details */}
            {task.result_packet && (
              <>
                {task.result_packet.files_changed.length > 0 && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                      <h3>Files Changed</h3>
                    </div>
                    {task.result_packet.files_changed.map((fc, i) => (
                      <div key={i} style={{ marginBottom: 8 }}>
                        <strong>{fc.operation}:</strong> {fc.path}
                        {fc.diff && (
                          <pre className="diff-viewer" style={{ marginTop: 4 }}>
                            {fc.diff.split('\n').map((line, j) => (
                              <span
                                key={j}
                                className={line.startsWith('+') ? 'diff-add' : line.startsWith('-') ? 'diff-remove' : ''}
                              >
                                {line}{'\n'}
                              </span>
                            ))}
                          </pre>
                        )}
                      </div>
                    ))}
                  </div>
                )}

                {task.result_packet.commands_executed.length > 0 && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                      <h3>Commands Executed</h3>
                    </div>
                    {task.result_packet.commands_executed.map((cmd, i) => (
                      <div key={i} className="subtask-item">
                        <code style={{ flex: 1 }}>{cmd.command}</code>
                        <span className={`badge ${cmd.exit_code === 0 ? 'badge-completed' : 'badge-failed'}`}>
                          exit {cmd.exit_code}
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {task.result_packet.remaining_todos.length > 0 && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                      <h3>Remaining TODOs</h3>
                    </div>
                    <ul style={{ paddingLeft: 20 }}>
                      {task.result_packet.remaining_todos.map((todo, i) => (
                        <li key={i} style={{ fontSize: '0.875rem' }}>{todo}</li>
                      ))}
                    </ul>
                  </div>
                )}

                {task.result_packet.next_suggestions.length > 0 && (
                  <div className="card" style={{ marginBottom: 16 }}>
                    <div className="card-header">
                      <h3>Suggested Next Steps</h3>
                    </div>
                    <ul style={{ paddingLeft: 20 }}>
                      {task.result_packet.next_suggestions.map((sug, i) => (
                        <li key={i} style={{ fontSize: '0.875rem' }}>{sug}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function formatRole(role: string): string {
  const map: Record<string, string> = {
    product_manager: 'PM',
    architect: 'Architect',
    implementer: 'Implementer',
    qa_tester: 'QA/Tester',
    security: 'Security',
    docs_trainer: 'Docs',
    performance: 'Performance',
    orchestrator: 'Orchestrator',
  };
  return map[role] || role;
}

function formatTime(timestamp: string): string {
  try {
    return new Date(timestamp).toLocaleTimeString();
  } catch {
    return timestamp;
  }
}

function formatEventPayload(event: WSEvent): string {
  const { type, task_id, timestamp, ...rest } = event;
  if (rest.message) return String(rest.message);
  if (rest.subtask_id) return `Subtask: ${String(rest.subtask_id).substring(0, 8)}...`;
  return JSON.stringify(rest).substring(0, 100);
}
