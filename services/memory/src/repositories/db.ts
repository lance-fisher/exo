import { Pool, PoolConfig } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

export interface DatabaseConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  password: string;
}

export function createPool(config?: Partial<DatabaseConfig>): Pool {
  const poolConfig: PoolConfig = {
    host: config?.host || process.env.DB_HOST || 'localhost',
    port: config?.port || parseInt(process.env.DB_PORT || '5432', 10),
    database: config?.database || process.env.DB_NAME || 'dca',
    user: config?.user || process.env.DB_USER || 'dca',
    password: config?.password || process.env.DB_PASSWORD || 'dca_secret',
    max: 20,
    idleTimeoutMillis: 30000,
    connectionTimeoutMillis: 5000,
  };
  return new Pool(poolConfig);
}

export async function initializeDatabase(pool: Pool): Promise<void> {
  const schemaPath = path.join(__dirname, '..', 'schema', 'tables.sql');
  const schema = fs.readFileSync(schemaPath, 'utf-8');
  await pool.query(schema);
}
