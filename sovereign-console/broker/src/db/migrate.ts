import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { loadConfig } from '../config.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

async function migrate(): Promise<void> {
  const config = loadConfig();
  const client = new pg.Client({ connectionString: config.DATABASE_URL });

  try {
    await client.connect();
    console.log('Connected to database');

    const schemaPath = resolve(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf-8');

    console.log('Running schema migration...');
    await client.query(schema);
    console.log('Migration completed successfully');
  } catch (err) {
    console.error('Migration failed:', err);
    process.exit(1);
  } finally {
    await client.end();
  }
}

migrate();
