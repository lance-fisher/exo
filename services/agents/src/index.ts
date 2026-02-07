import { createPool, initializeDatabase } from '@dca/memory/dist/repositories/db';
import { MemoryStore } from '@dca/memory';
import { RedisEventBus } from '@dca/memory/dist/repositories/EventBus';
import { BaseAgent } from './framework/BaseAgent';
import { ProductManagerAgent } from './roles/ProductManagerAgent';
import { ArchitectAgent } from './roles/ArchitectAgent';
import { ImplementerAgent } from './roles/ImplementerAgent';
import { QATesterAgent } from './roles/QATesterAgent';
import { SecurityAgent } from './roles/SecurityAgent';
import { DocsTrainerAgent } from './roles/DocsTrainerAgent';
import { PerformanceAgent } from './roles/PerformanceAgent';

const REDIS_URL = process.env.REDIS_URL || 'redis://redis:6379';
const AGENT_ROLES = (process.env.AGENT_ROLES || 'all').split(',');

async function main() {
  console.log('[agents] Starting agent workers...');

  // Initialize database
  const pool = createPool();

  // Wait for database to be ready (retry with backoff)
  let retries = 0;
  while (retries < 10) {
    try {
      await initializeDatabase(pool);
      break;
    } catch (err) {
      retries++;
      console.log(`[agents] Waiting for database... (attempt ${retries}/10)`);
      await new Promise(resolve => setTimeout(resolve, 2000 * retries));
    }
  }

  console.log('[agents] Database connected');

  const memory = new MemoryStore(pool);
  const eventBus = new RedisEventBus(REDIS_URL);

  // Retry Redis connection
  retries = 0;
  while (retries < 10) {
    try {
      await eventBus.connect();
      break;
    } catch (err) {
      retries++;
      console.log(`[agents] Waiting for Redis... (attempt ${retries}/10)`);
      await new Promise(resolve => setTimeout(resolve, 2000 * retries));
    }
  }

  console.log('[agents] Event bus connected');

  // Instantiate agents
  const allAgents: BaseAgent[] = [
    new ProductManagerAgent(memory, eventBus),
    new ArchitectAgent(memory, eventBus),
    new ImplementerAgent(memory, eventBus),
    new QATesterAgent(memory, eventBus),
    new SecurityAgent(memory, eventBus),
    new DocsTrainerAgent(memory, eventBus),
    new PerformanceAgent(memory, eventBus),
  ];

  // Filter to requested roles
  const agents = AGENT_ROLES.includes('all')
    ? allAgents
    : allAgents.filter(a => AGENT_ROLES.includes(a.role));

  // Start all agents
  await Promise.all(agents.map(a => a.start()));
  console.log(`[agents] Started ${agents.length} agents: ${agents.map(a => a.role).join(', ')}`);

  // Graceful shutdown
  process.on('SIGTERM', async () => {
    console.log('[agents] Shutting down agents...');
    await Promise.all(agents.map(a => a.stop()));
    await eventBus.disconnect();
    await pool.end();
    process.exit(0);
  });

  // Keep process alive
  process.on('SIGINT', async () => {
    console.log('[agents] Interrupted, shutting down...');
    await Promise.all(agents.map(a => a.stop()));
    await eventBus.disconnect();
    await pool.end();
    process.exit(0);
  });
}

main().catch(err => {
  console.error('[agents] Fatal error:', err);
  process.exit(1);
});
