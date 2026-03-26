// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console UI — React Hooks
// ─────────────────────────────────────────────────────────────────────────────

'use client';

import { useState, useEffect, useCallback, useRef } from 'react';
import { api, type Session, type Device, type SystemStatus, type TokenUsage, type ApprovalToken } from './api';

const BASE_URL = process.env.NEXT_PUBLIC_API_URL ?? '';

// ── Session ─────────────────────────────────────────────────────────────────

export function useSession() {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.auth.session().then((res) => {
      if (res.data) setSession(res.data);
      setLoading(false);
    });
  }, []);

  return { session, loading };
}

// ── Agent Status ────────────────────────────────────────────────────────────

export function useAgentStatus(pollMs = 10_000) {
  const [status, setStatus] = useState<SystemStatus | null>(null);

  useEffect(() => {
    const poll = () => {
      api.system.health().then((res) => {
        if (res.data) setStatus(res.data);
      });
    };

    poll();
    const interval = setInterval(poll, pollMs);
    return () => clearInterval(interval);
  }, [pollMs]);

  return { status };
}

// ── Token Usage ─────────────────────────────────────────────────────────────

export function useTokenUsage(pollMs = 30_000) {
  const [usage, setUsage] = useState<TokenUsage | null>(null);

  const refresh = useCallback(() => {
    api.tasks.usage().then((res) => {
      if (res.data) setUsage(res.data);
    });
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, pollMs);
    return () => clearInterval(interval);
  }, [pollMs, refresh]);

  return { usage, refresh };
}

// ── Devices ─────────────────────────────────────────────────────────────────

export function useDevices() {
  const [devices, setDevices] = useState<Device[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(() => {
    setLoading(true);
    api.devices.list().then((res) => {
      if (res.data) setDevices(res.data);
      setLoading(false);
    });
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  return { devices, loading, refresh };
}

// ── Pending Approvals ───────────────────────────────────────────────────────

export function usePendingApprovals(pollMs = 10_000) {
  const [approvals, setApprovals] = useState<ApprovalToken[]>([]);

  useEffect(() => {
    const poll = () => {
      api.approvals.pending().then((res) => {
        if (res.data) setApprovals(res.data.pending);
      });
    };

    poll();
    const interval = setInterval(poll, pollMs);
    return () => clearInterval(interval);
  }, [pollMs]);

  return { approvals };
}

// ── Task Stream (SSE) ───────────────────────────────────────────────────────

export interface TaskStreamEvent {
  type: string;
  data: Record<string, unknown>;
  timestamp: number;
}

export function useTaskStream(taskId: string | null) {
  const [events, setEvents] = useState<TaskStreamEvent[]>([]);
  const [connected, setConnected] = useState(false);
  const [output, setOutput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tokensUsed, setTokensUsed] = useState(0);
  const sourceRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!taskId) {
      setEvents([]);
      setConnected(false);
      setOutput('');
      setStreaming(false);
      setError(null);
      setTokensUsed(0);
      return;
    }

    setStreaming(true);
    const es = new EventSource(`${BASE_URL}/api/tasks/${taskId}/stream`, {
      withCredentials: true,
    });
    sourceRef.current = es;

    es.onopen = () => setConnected(true);
    es.onerror = () => {
      setConnected(false);
      setStreaming(false);
    };

    es.addEventListener('connected', () => setConnected(true));
    es.addEventListener('progress', (e) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        setEvents((prev) => [...prev, { type: 'progress', data, timestamp: Date.now() }]);
        if (typeof data.output === 'string') {
          setOutput((prev) => prev + data.output);
        }
        if (typeof data.tokens_used === 'number') {
          setTokensUsed(data.tokens_used as number);
        }
      } catch {
        // ignore parse errors
      }
    });
    es.addEventListener('complete', (e) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        setEvents((prev) => [...prev, { type: 'complete', data, timestamp: Date.now() }]);
        if (typeof data.output === 'string') {
          setOutput((prev) => prev + data.output);
        }
        if (typeof data.tokens_used === 'number') {
          setTokensUsed(data.tokens_used as number);
        }
      } catch {
        // ignore parse errors
      }
      setStreaming(false);
      es.close();
    });
    es.addEventListener('error_event', (e) => {
      try {
        const data = JSON.parse(e.data) as Record<string, unknown>;
        setEvents((prev) => [...prev, { type: 'error', data, timestamp: Date.now() }]);
        if (typeof data.message === 'string') {
          setError(data.message as string);
        }
      } catch {
        // ignore parse errors
      }
      setStreaming(false);
    });

    return () => {
      es.close();
      sourceRef.current = null;
      setConnected(false);
      setStreaming(false);
    };
  }, [taskId]);

  return { events, connected, output, streaming, error, tokensUsed };
}
