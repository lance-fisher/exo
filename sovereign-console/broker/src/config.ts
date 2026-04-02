import { z } from 'zod';

const configSchema = z.object({
  // Database
  DATABASE_URL: z.string().url('DATABASE_URL must be a valid PostgreSQL connection string'),

  // Redis
  REDIS_URL: z.string().url('REDIS_URL must be a valid Redis connection string'),

  // Server
  BROKER_PORT: z.coerce.number().int().min(1).max(65535).default(3100),
  BROKER_HOST: z.string().default('127.0.0.1'),

  // Secrets
  JWT_SECRET: z.string().min(64, 'JWT_SECRET must be at least 64 characters'),
  SESSION_SECRET: z.string().min(32, 'SESSION_SECRET must be at least 32 characters'),

  // WebAuthn
  WEBAUTHN_RP_ID: z.string().min(1),
  WEBAUTHN_RP_NAME: z.string().min(1),
  WEBAUTHN_ORIGIN: z.string().url(),

  // Agent mTLS
  AGENT_MTLS_CA_CERT: z.string().min(1),
  AGENT_MTLS_CERT: z.string().min(1),
  AGENT_MTLS_KEY: z.string().min(1),

  // TOTP
  TOTP_ENCRYPTION_KEY: z.string().min(64, 'TOTP_ENCRYPTION_KEY must be at least 64 hex characters'),

  // Approval Tokens
  APPROVAL_TOKEN_TTL_WRITE: z.coerce.number().int().min(30).max(600).default(120),
  APPROVAL_TOKEN_TTL_DANGEROUS: z.coerce.number().int().min(15).max(300).default(60),

  // Command Queue
  AGENT_QUEUE_TTL_SECONDS: z.coerce.number().int().min(30).max(3600).default(300),

  // Claude Code Limits
  CLAUDE_MAX_TOKENS_PER_TASK: z.coerce.number().int().min(1000).default(50000),
  CLAUDE_MAX_TASKS_PER_SESSION: z.coerce.number().int().min(1).default(20),
  CLAUDE_DAILY_SPEND_THRESHOLD: z.coerce.number().min(0).default(25.0),

  // Project Root (filesystem scope boundary for file operations)
  PROJECT_ROOT: z.string().min(1).default('/home/operator/projects'),

  // CORS
  CORS_ORIGIN: z.string().url().default('https://ops.lancewfisher.com'),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('info'),
});

export type Config = z.infer<typeof configSchema>;

let _config: Config | null = null;

export function loadConfig(): Config {
  if (_config) return _config;

  const result = configSchema.safeParse(process.env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const messages = Object.entries(errors)
      .map(([key, errs]) => `  ${key}: ${(errs ?? []).join(', ')}`)
      .join('\n');
    throw new Error(`Invalid configuration:\n${messages}`);
  }

  _config = result.data;
  return _config;
}

export function getConfig(): Config {
  if (!_config) {
    throw new Error('Config not loaded. Call loadConfig() first.');
  }
  return _config;
}
