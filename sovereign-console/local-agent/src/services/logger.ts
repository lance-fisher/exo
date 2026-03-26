// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — Logger Factory
// ─────────────────────────────────────────────────────────────────────────────

import winston from "winston";
import path from "node:path";
import { mkdirSync } from "node:fs";

let logPath = process.env["LOG_PATH"] ?? "logs/agent.log";
let logLevel = process.env["LOG_LEVEL"] ?? "info";

const logDir = path.dirname(path.resolve(logPath));
mkdirSync(logDir, { recursive: true });

const sharedTransports: winston.transport[] = [
  new winston.transports.Console({
    format: winston.format.combine(
      winston.format.colorize(),
      winston.format.printf(({ level, message, service, timestamp, ...meta }) => {
        const svc = service ? `[${service}]` : "";
        const extra = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : "";
        return `${timestamp as string} ${level} ${svc} ${message as string}${extra}`;
      }),
    ),
  }),
  new winston.transports.File({
    filename: path.resolve(logPath),
    maxsize: 10 * 1024 * 1024, // 10 MB
    maxFiles: 5,
    tailable: true,
    format: winston.format.combine(
      winston.format.uncolorize(),
      winston.format.json(),
    ),
  }),
];

/**
 * Create a child logger tagged with a service/component name.
 */
export function createLogger(service: string): winston.Logger {
  return winston.createLogger({
    level: logLevel,
    defaultMeta: { service },
    format: winston.format.combine(
      winston.format.timestamp({ format: "YYYY-MM-DD HH:mm:ss.SSS" }),
      winston.format.errors({ stack: true }),
    ),
    transports: sharedTransports,
  });
}

/**
 * Update log configuration at runtime (called after config is loaded).
 */
export function configureLogging(newLogPath: string, newLogLevel: string): void {
  logPath = newLogPath;
  logLevel = newLogLevel;
}
