import { useState, useEffect, useRef, useCallback } from 'react';

export interface WSEvent {
  type: string;
  task_id?: string;
  timestamp: string;
  [key: string]: unknown;
}

interface UseWebSocketReturn {
  connected: boolean;
  events: WSEvent[];
  subscribe: (taskId: string) => void;
  unsubscribe: (taskId: string) => void;
}

export function useWebSocket(url?: string): UseWebSocketReturn {
  const [connected, setConnected] = useState(false);
  const [events, setEvents] = useState<WSEvent[]>([]);
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);

  const connect = useCallback(() => {
    const wsUrl = url || `ws://${window.location.hostname}:3001/ws`;

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        setConnected(true);
        console.log('[ws] Connected');
      };

      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data) as WSEvent;
          setEvents(prev => [...prev.slice(-500), data]);
        } catch {
          console.error('[ws] Failed to parse message');
        }
      };

      ws.onclose = () => {
        setConnected(false);
        console.log('[ws] Disconnected, reconnecting in 3s...');
        reconnectTimerRef.current = window.setTimeout(connect, 3000);
      };

      ws.onerror = () => {
        ws.close();
      };
    } catch {
      reconnectTimerRef.current = window.setTimeout(connect, 3000);
    }
  }, [url]);

  useEffect(() => {
    connect();
    return () => {
      if (reconnectTimerRef.current) {
        clearTimeout(reconnectTimerRef.current);
      }
      wsRef.current?.close();
    };
  }, [connect]);

  const subscribe = useCallback((taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'subscribe', task_id: taskId }));
    }
  }, []);

  const unsubscribe = useCallback((taskId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'unsubscribe', task_id: taskId }));
    }
  }, []);

  return { connected, events, subscribe, unsubscribe };
}
