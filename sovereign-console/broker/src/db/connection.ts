import pg from 'pg';
import { getConfig } from '../config.js';
import { logger } from '../logger.js';

const { Pool } = pg;

let pool: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (!pool) {
    throw new Error('Database pool not initialized. Call initDatabase() first.');
  }
  return pool;
}

export async function initDatabase(): Promise<pg.Pool> {
  const config = getConfig();

  pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    statement_timeout: 30_000,
  });

  pool.on('error', (err: Error) => {
    logger.error('Unexpected database pool error', { error: err.message });
  });

  // Verify connectivity
  const client = await pool.connect();
  try {
    const result = await client.query('SELECT NOW() AS now');
    logger.info('Database connected', { server_time: result.rows[0]?.now });
  } finally {
    client.release();
  }

  return pool;
}

export async function closeDatabase(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    logger.info('Database pool closed');
  }
}

/** Execute a query with parameterized values */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params?: unknown[],
): Promise<pg.QueryResult<T>> {
  const start = Date.now();
  const result = await getPool().query<T>(text, params);
  const duration = Date.now() - start;

  logger.debug('Executed query', {
    text: text.substring(0, 100),
    duration,
    rows: result.rowCount,
  });

  return result;
}

/** Execute within a transaction */
export async function withTransaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
