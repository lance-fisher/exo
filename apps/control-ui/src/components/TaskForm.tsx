import React, { useState, useRef } from 'react';

interface TaskFormProps {
  onSubmit: (request: string) => Promise<void>;
}

export function TaskForm({ onSubmit }: TaskFormProps) {
  const [request, setRequest] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!request.trim() || submitting) return;

    setSubmitting(true);
    try {
      await onSubmit(request.trim());
      setRequest('');
    } finally {
      setSubmitting(false);
      inputRef.current?.focus();
    }
  };

  return (
    <form onSubmit={handleSubmit} className="task-form card" aria-label="Submit a new task">
      <label htmlFor="task-input">What would you like done?</label>
      <p style={{ fontSize: '0.8125rem', color: 'var(--text-muted)', marginBottom: 8 }}>
        Describe your task in plain English. The agent team will break it down, plan, and execute it.
      </p>
      <div className="form-row">
        <textarea
          ref={inputRef}
          id="task-input"
          className="input"
          value={request}
          onChange={e => setRequest(e.target.value)}
          placeholder="e.g., Add a dark mode toggle to the settings page"
          rows={2}
          disabled={submitting}
          aria-describedby="task-hint"
        />
        <button
          type="submit"
          className="btn btn-primary"
          disabled={!request.trim() || submitting}
          aria-busy={submitting}
        >
          {submitting ? (
            <>
              <span className="spinner" aria-hidden="true" />
              <span className="sr-only">Submitting</span>
            </>
          ) : (
            'Submit Task'
          )}
        </button>
      </div>
      <p id="task-hint" className="sr-only">
        Enter a task description and press Submit Task or Enter to begin processing.
      </p>
    </form>
  );
}
