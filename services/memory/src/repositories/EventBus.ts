import { createClient, RedisClientType } from 'redis';

export interface DCAEvent {
  id: string;
  task_id: string;
  subtask_id?: string;
  event_type: string;
  agent_role?: string;
  payload: Record<string, unknown>;
  timestamp: string;
}

export interface EventBus {
  publish(channel: string, event: DCAEvent): Promise<void>;
  subscribe(channel: string, handler: (event: DCAEvent) => void): Promise<void>;
  unsubscribe(channel: string): Promise<void>;
  disconnect(): Promise<void>;
}

export class RedisEventBus implements EventBus {
  private publisher: RedisClientType;
  private subscriber: RedisClientType;
  private connected = false;

  constructor(redisUrl?: string) {
    const url = redisUrl || process.env.REDIS_URL || 'redis://localhost:6379';
    this.publisher = createClient({ url }) as RedisClientType;
    this.subscriber = this.publisher.duplicate() as RedisClientType;
  }

  async connect(): Promise<void> {
    if (this.connected) return;
    await this.publisher.connect();
    await this.subscriber.connect();
    this.connected = true;
  }

  async publish(channel: string, event: DCAEvent): Promise<void> {
    if (!this.connected) await this.connect();
    await this.publisher.publish(channel, JSON.stringify(event));
  }

  async subscribe(channel: string, handler: (event: DCAEvent) => void): Promise<void> {
    if (!this.connected) await this.connect();
    await this.subscriber.subscribe(channel, (message: string) => {
      try {
        const event = JSON.parse(message) as DCAEvent;
        handler(event);
      } catch (err) {
        console.error(`Failed to parse event on channel ${channel}:`, err);
      }
    });
  }

  async unsubscribe(channel: string): Promise<void> {
    await this.subscriber.unsubscribe(channel);
  }

  async disconnect(): Promise<void> {
    if (!this.connected) return;
    await this.publisher.disconnect();
    await this.subscriber.disconnect();
    this.connected = false;
  }
}

/**
 * In-process event bus for simpler deployments without Redis.
 * Supports concurrency via async handlers.
 */
export class InProcessEventBus implements EventBus {
  private handlers: Map<string, Array<(event: DCAEvent) => void>> = new Map();

  async publish(channel: string, event: DCAEvent): Promise<void> {
    const channelHandlers = this.handlers.get(channel) || [];
    await Promise.all(channelHandlers.map(handler => {
      try {
        return Promise.resolve(handler(event));
      } catch (err) {
        console.error(`Handler error on channel ${channel}:`, err);
        return Promise.resolve();
      }
    }));
  }

  async subscribe(channel: string, handler: (event: DCAEvent) => void): Promise<void> {
    if (!this.handlers.has(channel)) {
      this.handlers.set(channel, []);
    }
    this.handlers.get(channel)!.push(handler);
  }

  async unsubscribe(channel: string): Promise<void> {
    this.handlers.delete(channel);
  }

  async disconnect(): Promise<void> {
    this.handlers.clear();
  }
}
