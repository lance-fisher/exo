import Fastify from 'fastify';
import fastifyCors from '@fastify/cors';
import fastifyHelmet from '@fastify/helmet';
import fastifyRateLimit from '@fastify/rate-limit';
import fastifyCookie from '@fastify/cookie';
import fastifyWebsocket from '@fastify/websocket';
import { loadConfig } from './config.js';
import { initDatabase, closeDatabase } from './db/connection.js';
import { initRedis, closeRedis, getRedis } from './redis.js';
import { registerSecurityMiddleware, validateReplayProtection } from './middleware/security.js';
import { handleAgentConnect } from './agent-relay/index.js';
import { expireStaleTokens } from './approval/index.js';
import { expireStaleCommands } from './agent-relay/command-queue.js';
import { appendLog } from './audit/index.js';
import { logger } from './logger.js';

// Route plugins
import { authRoutes } from './routes/auth.js';
import { deviceRoutes } from './routes/devices.js';
import { taskRoutes } from './routes/tasks.js';
import { fileRoutes } from './routes/files.js';
import { auditRoutes } from './routes/audit.js';
import { systemRoutes } from './routes/system.js';
import { approvalRoutes } from './routes/approval.js';

async function main(): Promise<void> {
  // --- Load and validate configuration ---
  const config = loadConfig();
  logger.info('Configuration loaded');

  // --- Initialize external connections ---
  await initDatabase();
  await initRedis();

  // --- Check emergency disable flag ---
  const redis = getRedis();
  const emergencyDisabled = await redis.get('system:emergency_disabled');
  if (emergencyDisabled === '1') {
    logger.warn('System is in EMERGENCY DISABLED state. Clear Redis key "system:emergency_disabled" to re-enable.');
  }

  // --- Create Fastify instance ---
  const app = Fastify({
    logger: false, // We use Winston instead
    trustProxy: true, // Behind NGINX
    bodyLimit: 1_048_576, // 1MB
    requestTimeout: 30_000,
  });

  // --- Emergency disable check hook ---
  app.addHook('onRequest', async (request, reply) => {
    // Allow health checks even when disabled
    if (request.url === '/api/system/health') return;

    const disabled = await redis.get('system:emergency_disabled');
    if (disabled === '1') {
      reply.code(503).send({
        error: 'System is emergency disabled',
        code: 'EMERGENCY_DISABLED',
      });
    }
  });

  // --- Security plugins ---
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: false, // We set CSP manually for more control
    crossOriginEmbedderPolicy: false,
  });

  await app.register(fastifyCors, {
    origin: config.CORS_ORIGIN,
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'X-Request-Nonce',
      'X-Request-Signature',
      'X-CSRF-Token',
    ],
    maxAge: 600, // 10 minutes
  });

  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute',
    keyGenerator: (request) => request.ip,
    errorResponseBuilder: (_request, context) => ({
      error: 'Rate limit exceeded',
      code: 'RATE_LIMITED',
      retry_after: Math.ceil(context.ttl / 1000),
    }),
  });

  await app.register(fastifyCookie, {
    secret: config.SESSION_SECRET,
    parseOptions: {},
  });

  // --- Custom security middleware ---
  await registerSecurityMiddleware(app);

  // Anti-replay on mutating requests
  app.addHook('preHandler', validateReplayProtection);

  // --- WebSocket for agent connection ---
  await app.register(fastifyWebsocket);

  app.register(async (wsApp) => {
    wsApp.get('/ws/agent', { websocket: true }, (socket, request) => {
      // Extract client certificate fingerprint from the TLS connection
      // In production, NGINX passes this via header after mTLS verification
      const certFingerprint = request.headers['x-client-cert-fingerprint'] as string | undefined;

      if (!certFingerprint) {
        logger.warn('Agent WebSocket connection without certificate fingerprint', { ip: request.ip });
        socket.close(4001, 'Client certificate required');
        return;
      }

      handleAgentConnect(socket, certFingerprint).catch((err) => {
        logger.error('Agent connection setup failed', { error: (err as Error).message });
      });
    });
  });

  // --- Register route plugins ---
  await app.register(authRoutes);
  await app.register(deviceRoutes);
  await app.register(taskRoutes);
  await app.register(fileRoutes);
  await app.register(auditRoutes);
  await app.register(systemRoutes);
  await app.register(approvalRoutes);

  // --- Request logging ---
  app.addHook('onResponse', async (request, reply) => {
    logger.http('Request completed', {
      method: request.method,
      url: request.url,
      status: reply.statusCode,
      response_time: reply.elapsedTime,
      ip: request.ip,
    });
  });

  // --- Error handler ---
  app.setErrorHandler(async (rawError, request, reply) => {
    const error = rawError as Error & { statusCode?: number };
    logger.error('Unhandled error', {
      error: error.message,
      stack: error.stack,
      method: request.method,
      url: request.url,
      ip: request.ip,
    });

    // Don't leak internal errors
    const statusCode = error.statusCode ?? 500;
    reply.code(statusCode).send({
      error: statusCode >= 500 ? 'Internal server error' : error.message,
      code: 'INTERNAL_ERROR',
    });
  });

  // --- Background jobs ---
  const backgroundInterval = setInterval(async () => {
    try {
      await expireStaleTokens();
      await expireStaleCommands();
    } catch (err) {
      logger.error('Background job error', { error: (err as Error).message });
    }
  }, 30_000); // Every 30 seconds

  // --- Graceful shutdown ---
  const shutdown = async (signal: string) => {
    logger.info(`Received ${signal}, starting graceful shutdown...`);
    clearInterval(backgroundInterval);

    try {
      await app.close();
      logger.info('Fastify server closed');
    } catch (err) {
      logger.error('Error closing Fastify', { error: (err as Error).message });
    }

    try {
      await closeRedis();
      await closeDatabase();
    } catch (err) {
      logger.error('Error closing connections', { error: (err as Error).message });
    }

    logger.info('Shutdown complete');
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown('SIGTERM'));
  process.on('SIGINT', () => void shutdown('SIGINT'));

  process.on('unhandledRejection', (reason) => {
    logger.error('Unhandled rejection', { reason: String(reason) });
  });

  process.on('uncaughtException', (error) => {
    logger.error('Uncaught exception', { error: error.message, stack: error.stack });
    process.exit(1);
  });

  // --- Start server ---
  try {
    await app.listen({
      port: config.BROKER_PORT,
      host: config.BROKER_HOST,
    });

    logger.info(`Sovereign Console Broker running on ${config.BROKER_HOST}:${config.BROKER_PORT}`);

    await appendLog({
      event_type: 'system.health_check',
      action: 'Broker started',
      detail: {
        port: config.BROKER_PORT,
        host: config.BROKER_HOST,
        node_version: process.version,
      },
      ip_address: '127.0.0.1',
    });
  } catch (err) {
    logger.error('Failed to start server', { error: (err as Error).message });
    process.exit(1);
  }
}

main().catch((err) => {
  logger.error('Fatal startup error', { error: (err as Error).message, stack: (err as Error).stack });
  process.exit(1);
});
