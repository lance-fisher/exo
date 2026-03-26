import { Redis } from 'ioredis';
import { getConfig } from './config.js';
import { logger } from './logger.js';

let redis: Redis | null = null;

export function getRedis(): Redis {
  if (!redis) {
    throw new Error('Redis not initialized. Call initRedis() first.');
  }
  return redis;
}

export async function initRedis(): Promise<Redis> {
  const config = getConfig();

  redis = new Redis(config.REDIS_URL, {
    maxRetriesPerRequest: 3,
    retryStrategy(times: number) {
      const delay = Math.min(times * 200, 5000);
      return delay;
    },
    lazyConnect: true,
  });

  redis.on('error', (err: Error) => {
    logger.error('Redis connection error', { error: err.message });
  });

  redis.on('connect', () => {
    logger.info('Redis connected');
  });

  await redis.connect();
  return redis;
}

export async function closeRedis(): Promise<void> {
  if (redis) {
    await redis.quit();
    redis = null;
    logger.info('Redis connection closed');
  }
}
