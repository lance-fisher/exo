// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — Main Entry Point
// ─────────────────────────────────────────────────────────────────────────────

import { loadConfig, type AgentConfig } from "./config.js";
import { BrokerConnection } from "./services/broker-connection.js";
import { ClaudeIntegrationService } from "./services/claude-integration.js";
import { FileOperationsService, FileOperationError } from "./services/file-operations.js";
import { SecretRedactionService } from "./services/secret-redaction.js";
import { GovernanceEngine, GovernanceError } from "./governance/index.js";
import { createLogger, configureLogging } from "./services/logger.js";
import type {
  AgentCommand,
  AgentResponse,
  AgentStatus,
  TaskResult,
  FileContent,
  DirectoryListing,
  DiffResult,
  FileWriteResult,
} from "./types/index.js";

const VERSION = "1.0.0";
const logger = createLogger("main");

// ── State ───────────────────────────────────────────────────────────────────

let config: AgentConfig;
let broker: BrokerConnection;
let claude: ClaudeIntegrationService;
let files: FileOperationsService;
let redactor: SecretRedactionService;
let governance: GovernanceEngine;
let startTime: number;
let activeTaskCount = 0;

// ── Bootstrap ───────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info("Sovereign Console Local Agent starting", { version: VERSION });

  // 1. Load and validate configuration
  try {
    config = loadConfig();
  } catch (err) {
    logger.error("Configuration failed", { error: err });
    process.exit(1);
  }

  // Update logger with loaded config
  configureLogging(config.logPath, config.logLevel);

  logger.info("Configuration loaded", {
    agentId: config.agentId,
    brokerUrl: config.brokerWsUrl,
    projectsRoot: config.projectsRoot,
    allowedProjects: config.allowedProjects,
  });

  // 2. Initialize services
  redactor = new SecretRedactionService();
  governance = new GovernanceEngine(config);
  claude = new ClaudeIntegrationService(config, redactor);
  files = new FileOperationsService(config, redactor, governance);

  // 3. Connect to broker
  broker = new BrokerConnection(config);

  broker.on("connected", () => {
    logger.info("Broker connection established");
  });

  broker.on("disconnected", (reason: string) => {
    logger.warn("Broker disconnected", { reason });
  });

  broker.on("error", (err: Error) => {
    logger.error("Broker connection error", { message: err.message });
  });

  broker.on("command", (command: AgentCommand) => {
    handleCommand(command).catch((err) => {
      logger.error("Unhandled error in command handler", {
        requestId: command.requestId,
        error: err,
      });
    });
  });

  broker.connect();
  startTime = Date.now();

  // 4. Set up graceful shutdown
  registerShutdownHandlers();

  logger.info("Agent initialized and connecting to broker");
}

// ── Command Dispatcher ──────────────────────────────────────────────────────

async function handleCommand(command: AgentCommand): Promise<void> {
  const startMs = Date.now();

  // Governance check first
  const violations = governance.validateCommand(command);
  if (violations.some((v) => v.severity === "block")) {
    const messages = violations
      .filter((v) => v.severity === "block")
      .map((v) => v.message);

    sendError(command.requestId, "GOVERNANCE_VIOLATION", messages.join("; "));
    return;
  }

  try {
    switch (command.type) {
      case "task":
        await handleTask(command);
        break;

      case "file_read":
        handleFileRead(command);
        break;

      case "file_browse":
        handleFileBrowse(command);
        break;

      case "file_write":
        handleFileWrite(command);
        break;

      case "file_diff":
        handleFileDiff(command);
        break;

      case "project_list":
        handleProjectList(command);
        break;

      case "status":
        handleStatus(command);
        break;

      default: {
        void (command satisfies never);
        sendError((command as { requestId: string }).requestId, "UNKNOWN_COMMAND", `Unknown command type`);
      }
    }
  } catch (err) {
    const duration = Date.now() - startMs;
    if (err instanceof FileOperationError) {
      sendError(command.requestId, err.code, err.message);
    } else if (err instanceof GovernanceError) {
      sendError(command.requestId, err.code, err.message);
    } else {
      logger.error("Command execution failed", {
        requestId: command.requestId,
        type: command.type,
        duration,
        error: err,
      });
      sendError(
        command.requestId,
        "INTERNAL_ERROR",
        err instanceof Error ? err.message : "An unexpected error occurred",
      );
    }
  }
}

// ── Command Handlers ────────────────────────────────────────────────────────

async function handleTask(command: Extract<AgentCommand, { type: "task" }>): Promise<void> {
  activeTaskCount++;
  try {
    const result = await claude.executeTask(command);
    sendSuccess<TaskResult>(command.requestId, result);
  } finally {
    activeTaskCount--;
  }
}

function handleFileRead(command: Extract<AgentCommand, { type: "file_read" }>): void {
  const result = files.readFile(
    command.projectName,
    command.filePath,
    command.startLine,
    command.endLine,
  );
  sendSuccess<FileContent>(command.requestId, result);
}

function handleFileBrowse(command: Extract<AgentCommand, { type: "file_browse" }>): void {
  const result = files.browseDirectory(
    command.projectName,
    command.relativePath,
    command.depth,
  );
  sendSuccess<DirectoryListing>(command.requestId, result);
}

function handleFileWrite(command: Extract<AgentCommand, { type: "file_write" }>): void {
  const result = files.writeFile(
    command.projectName,
    command.filePath,
    command.content,
    command.approvalToken,
  );
  sendSuccess<FileWriteResult>(command.requestId, result);
}

function handleFileDiff(command: Extract<AgentCommand, { type: "file_diff" }>): void {
  const result = files.generateDiff(
    command.projectName,
    command.filePath,
    command.proposedContent,
  );
  sendSuccess<DiffResult>(command.requestId, result);
}

function handleProjectList(command: Extract<AgentCommand, { type: "project_list" }>): void {
  const projects = files.listProjects();
  sendSuccess(command.requestId, { projects });
}

function handleStatus(command: Extract<AgentCommand, { type: "status" }>): void {
  const sessionUsage = claude.getSessionUsage(command.sessionId);
  const dailyUsage = claude.getDailyUsage();
  const projects = files.listProjects();

  const status: AgentStatus = {
    agentId: config.agentId,
    connectionState: broker.state,
    uptime: Date.now() - startTime,
    activeTaskCount,
    sessionUsage: sessionUsage.totalTasks > 0 ? sessionUsage : null,
    dailyUsage,
    projectsAvailable: projects.filter((p) => p.exists).map((p) => p.name),
    version: VERSION,
  };

  sendSuccess<AgentStatus>(command.requestId, status);
}

// ── Response Helpers ────────────────────────────────────────────────────────

function sendSuccess<T>(requestId: string, data: T): void {
  const response: AgentResponse<T> = {
    status: "success",
    requestId,
    data,
    timestamp: new Date().toISOString(),
  };
  broker.send(response);
}

function sendError(requestId: string, code: string, message: string, details?: string): void {
  const response: AgentResponse = {
    status: "error",
    requestId,
    error: { code, message, details },
    timestamp: new Date().toISOString(),
  };
  broker.send(response);
}

// ── Graceful Shutdown ───────────────────────────────────────────────────────

function registerShutdownHandlers(): void {
  let shuttingDown = false;

  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;

    logger.info(`Received ${signal}, shutting down gracefully...`);

    // Disconnect from broker
    if (broker) {
      broker.disconnect();
    }

    // Destroy governance engine timers
    if (governance) {
      governance.destroy();
    }

    // Give in-flight tasks a few seconds to complete
    const forceExitTimer = setTimeout(() => {
      logger.warn("Force exit after shutdown timeout");
      process.exit(1);
    }, 15_000);

    // If no active tasks, exit immediately
    if (activeTaskCount === 0) {
      clearTimeout(forceExitTimer);
      logger.info("Clean shutdown complete");
      process.exit(0);
    }

    // Wait for active tasks to finish
    const checkInterval = setInterval(() => {
      if (activeTaskCount === 0) {
        clearInterval(checkInterval);
        clearTimeout(forceExitTimer);
        logger.info("All tasks completed, shutdown complete");
        process.exit(0);
      }
    }, 500);
  };

  process.on("SIGTERM", () => shutdown("SIGTERM"));
  process.on("SIGINT", () => shutdown("SIGINT"));

  // Handle Windows service stop signal
  process.on("message", (msg) => {
    if (msg === "shutdown") shutdown("service-stop");
  });

  // Catch uncaught exceptions and unhandled rejections
  process.on("uncaughtException", (err) => {
    logger.error("Uncaught exception", { error: err });
    shutdown("uncaughtException");
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled rejection", { reason });
    // Don't shut down for unhandled rejections — log and continue
  });
}

// ── Start ───────────────────────────────────────────────────────────────────

main().catch((err) => {
  logger.error("Fatal startup error", { error: err });
  process.exit(1);
});
