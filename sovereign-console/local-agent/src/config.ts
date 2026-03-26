// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — Typed Configuration Loader
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { z } from "zod";

// ── Schema ──────────────────────────────────────────────────────────────────

const configSchema = z.object({
  // Broker connection
  brokerWsUrl: z
    .string()
    .url()
    .startsWith("wss://", "Broker URL must use wss:// (TLS)"),
  agentId: z.string().min(1, "AGENT_ID is required"),
  agentSecret: z.string().min(16, "AGENT_SECRET must be at least 16 characters"),

  // Mutual TLS
  mtls: z.object({
    caCertPath: z.string().min(1),
    certPath: z.string().min(1),
    keyPath: z.string().min(1),
  }),

  // Project scope
  projectsRoot: z.string().min(1, "PROJECTS_ROOT is required"),
  allowedProjects: z.array(z.string()).min(1, "At least one allowed project is required"),
  protectedPaths: z.array(z.string()),

  // Claude Code integration
  claudeCliPath: z.string().default("claude"),
  maxTokensPerTask: z.number().int().positive().max(200_000).default(50_000),
  maxTasksPerSession: z.number().int().positive().max(100).default(20),
  dailySpendThreshold: z.number().int().positive().default(100_000),
  claudeTaskTimeoutMs: z.number().int().positive().default(300_000),

  // Logging
  logPath: z.string().default("logs/agent.log"),
  logLevel: z
    .enum(["error", "warn", "info", "http", "verbose", "debug", "silly"])
    .default("info"),

  // Windows service
  serviceAccountName: z.string().default(".\\SovereignAgent"),
});

export type AgentConfig = z.infer<typeof configSchema>;

// ── Loader ──────────────────────────────────────────────────────────────────

/**
 * Load a `.env` file manually (no dependency on dotenv).
 * Handles lines like KEY=value, KEY="value", and comments.
 */
function loadEnvFile(envPath: string): void {
  if (!existsSync(envPath)) return;

  const content = readFileSync(envPath, "utf-8");
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eqIndex = line.indexOf("=");
    if (eqIndex === -1) continue;

    const key = line.slice(0, eqIndex).trim();
    let value = line.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    // Only set if not already present (real env takes precedence)
    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function commaSplit(value: string | undefined, fallback: string[] = []): string[] {
  if (!value) return fallback;
  return value
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * Load and validate the agent configuration from environment variables.
 * Optionally loads a `.env` file from the given directory.
 */
export function loadConfig(baseDir?: string): AgentConfig {
  const envPath = path.resolve(baseDir ?? process.cwd(), ".env");
  loadEnvFile(envPath);

  const env = process.env;

  const raw = {
    brokerWsUrl: env["BROKER_WS_URL"] ?? "",
    agentId: env["AGENT_ID"] ?? "",
    agentSecret: env["AGENT_SECRET"] ?? "",
    mtls: {
      caCertPath: env["MTLS_CA_CERT"] ?? "certs/ca.pem",
      certPath: env["MTLS_CERT"] ?? "certs/agent.pem",
      keyPath: env["MTLS_KEY"] ?? "certs/agent-key.pem",
    },
    projectsRoot: env["PROJECTS_ROOT"] ?? "",
    allowedProjects: commaSplit(env["ALLOWED_PROJECTS"]),
    protectedPaths: commaSplit(
      env["PROTECTED_PATHS"],
      [".env*", "*.key", "*.pem", "*.p12", ".git/config", "credentials*", "**/secrets/**", "**/node_modules/**"],
    ),
    claudeCliPath: env["CLAUDE_CLI_PATH"] ?? "claude",
    maxTokensPerTask: parseInt(env["MAX_TOKENS_PER_TASK"] ?? "50000", 10),
    maxTasksPerSession: parseInt(env["MAX_TASKS_PER_SESSION"] ?? "20", 10),
    dailySpendThreshold: parseInt(env["DAILY_SPEND_THRESHOLD"] ?? "100000", 10),
    claudeTaskTimeoutMs: parseInt(env["CLAUDE_TASK_TIMEOUT_MS"] ?? "300000", 10),
    logPath: env["LOG_PATH"] ?? "logs/agent.log",
    logLevel: env["LOG_LEVEL"] ?? "info",
    serviceAccountName: env["SERVICE_ACCOUNT_NAME"] ?? ".\\SovereignAgent",
  };

  const result = configSchema.safeParse(raw);

  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(`Configuration validation failed:\n${issues}`);
  }

  // Verify mTLS cert files exist
  for (const [label, certPath] of [
    ["CA certificate", result.data.mtls.caCertPath],
    ["Agent certificate", result.data.mtls.certPath],
    ["Agent private key", result.data.mtls.keyPath],
  ] as const) {
    const resolved = path.isAbsolute(certPath)
      ? certPath
      : path.resolve(baseDir ?? process.cwd(), certPath);
    if (!existsSync(resolved)) {
      throw new Error(
        `${label} not found at ${resolved}. Run 'npm run generate-certs' to create certificates.`,
      );
    }
  }

  return result.data;
}

/**
 * Resolve a certificate path to an absolute path, reading its contents.
 */
export function readCertFile(certPath: string, baseDir?: string): string {
  const resolved = path.isAbsolute(certPath)
    ? certPath
    : path.resolve(baseDir ?? process.cwd(), certPath);
  return readFileSync(resolved, "utf-8");
}
