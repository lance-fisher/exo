import express from 'express';
import cors from 'cors';
import http from 'http';
import { WebSocketServer } from 'ws';
import { createPool, initializeDatabase } from '@dca/memory/dist/repositories/db';
import { MemoryStore } from '@dca/memory';
import { RedisEventBus } from '@dca/memory/dist/repositories/EventBus';
import { createTaskRoutes } from './routes/tasks';
import { WebSocketManager } from './events/WebSocketManager';
import { TaskCoordinator } from './controllers/TaskCoordinator';

const PORT = parseInt(process.env.PORT || '3001', 10);
const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';

async function main() {
  console.log('[orchestrator] Starting up...');

  // Initialize database
  const pool = createPool();
  await initializeDatabase(pool);
  console.log('[orchestrator] Database initialized');

  // Initialize stores
  const memory = new MemoryStore(pool);
  const eventBus = new RedisEventBus(REDIS_URL);
  await eventBus.connect();
  console.log('[orchestrator] Event bus connected');

  // Create Express app
  const app = express();
  app.use(cors());
  app.use(express.json());

  // Health check
  app.get('/health', (_req, res) => {
    res.json({ status: 'ok', service: 'orchestrator', timestamp: new Date().toISOString() });
  });

  // Create HTTP server for WebSocket support
  const server = http.createServer(app);

  // WebSocket setup
  const wss = new WebSocketServer({ server, path: '/ws' });
  const wsManager = new WebSocketManager(wss);
  console.log('[orchestrator] WebSocket server ready');

  // Task coordinator
  const coordinator = new TaskCoordinator(memory, eventBus, wsManager);
  await coordinator.initialize();
  console.log('[orchestrator] Task coordinator initialized');

  // Routes
  const taskRoutes = createTaskRoutes(memory, coordinator, wsManager);
  app.use('/api', taskRoutes);

  // Start server
  server.listen(PORT, '0.0.0.0', () => {
    console.log(`[orchestrator] API server listening on port ${PORT}`);
    console.log(`[orchestrator] WebSocket available at ws://0.0.0.0:${PORT}/ws`);
  });

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[orchestrator] Shutting down...');
    await eventBus.disconnect();
    await pool.end();
    server.close();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[orchestrator] Fatal error:', err);
  process.exit(1);
});
