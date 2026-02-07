import { WebSocketServer, WebSocket } from 'ws';
import { v4 as uuidv4 } from 'uuid';

interface WSClient {
  id: string;
  ws: WebSocket;
  subscribedTasks: Set<string>;
}

export class WebSocketManager {
  private clients: Map<string, WSClient> = new Map();

  constructor(wss: WebSocketServer) {
    wss.on('connection', (ws: WebSocket) => {
      const clientId = uuidv4();
      const client: WSClient = { id: clientId, ws, subscribedTasks: new Set() };
      this.clients.set(clientId, client);

      console.log(`[ws] Client connected: ${clientId}`);

      ws.on('message', (data: Buffer) => {
        try {
          const msg = JSON.parse(data.toString());
          this.handleClientMessage(client, msg);
        } catch (err) {
          console.error('[ws] Failed to parse message:', err);
        }
      });

      ws.on('close', () => {
        this.clients.delete(clientId);
        console.log(`[ws] Client disconnected: ${clientId}`);
      });

      // Send welcome message
      ws.send(JSON.stringify({
        type: 'connected',
        client_id: clientId,
        timestamp: new Date().toISOString(),
      }));
    });
  }

  private handleClientMessage(client: WSClient, msg: { type: string; task_id?: string }) {
    switch (msg.type) {
      case 'subscribe':
        if (msg.task_id) {
          client.subscribedTasks.add(msg.task_id);
          console.log(`[ws] Client ${client.id} subscribed to task ${msg.task_id}`);
        }
        break;
      case 'unsubscribe':
        if (msg.task_id) {
          client.subscribedTasks.delete(msg.task_id);
        }
        break;
    }
  }

  /**
   * Broadcast an event to all clients subscribed to a specific task
   */
  broadcastToTask(taskId: string, event: Record<string, unknown>): void {
    const message = JSON.stringify({
      ...event,
      task_id: taskId,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients.values()) {
      if (client.subscribedTasks.has(taskId) && client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  /**
   * Broadcast to ALL connected clients (for global events)
   */
  broadcastAll(event: Record<string, unknown>): void {
    const message = JSON.stringify({
      ...event,
      timestamp: new Date().toISOString(),
    });

    for (const client of this.clients.values()) {
      if (client.ws.readyState === WebSocket.OPEN) {
        client.ws.send(message);
      }
    }
  }

  getConnectedCount(): number {
    return this.clients.size;
  }
}
