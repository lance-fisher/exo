// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — Claude Code Integration
// ─────────────────────────────────────────────────────────────────────────────

import { spawn } from "node:child_process";
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
// uuid import available if needed for future task ID generation
import { encoding_for_model } from "tiktoken";
import type { AgentConfig } from "../config.js";
import type {
  TaskRequest,
  TaskResult,
  ProjectManifest,
  TokenUsageRecord,
  SessionUsageSummary,
  DailyUsageSummary,
} from "../types/index.js";
import { SecretRedactionService } from "./secret-redaction.js";
import { createLogger } from "./logger.js";

const logger = createLogger("claude-integration");

// ── Token Counter ───────────────────────────────────────────────────────────

let tokenEncoder: ReturnType<typeof encoding_for_model> | null = null;

function getTokenEncoder(): ReturnType<typeof encoding_for_model> {
  if (!tokenEncoder) {
    // cl100k_base is the encoding used by GPT-4 / Claude-compatible tokenizers
    tokenEncoder = encoding_for_model("gpt-4");
  }
  return tokenEncoder;
}

// ── Service ─────────────────────────────────────────────────────────────────

export class ClaudeIntegrationService {
  private readonly config: AgentConfig;
  private readonly redactor: SecretRedactionService;
  private readonly usageRecords: TokenUsageRecord[] = [];

  constructor(config: AgentConfig, redactor: SecretRedactionService) {
    this.config = config;
    this.redactor = redactor;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * Execute a task by spawning the Claude CLI as a subprocess.
   */
  async executeTask(task: TaskRequest): Promise<TaskResult> {
    const startTime = Date.now();
    const projectPath = path.join(this.config.projectsRoot, task.projectName);

    // Assemble context
    const context = await this.assembleContext(projectPath, task.description, task.focusFiles);

    // Check token limits before submission
    const contextTokens = this.getTokenCount(context);
    const maxTokens = Math.min(
      task.maxTokens ?? this.config.maxTokensPerTask,
      this.config.maxTokensPerTask,
    );

    if (contextTokens > maxTokens) {
      throw new Error(
        `Context exceeds token limit: ${contextTokens} tokens > ${maxTokens} max. ` +
          "Reduce scope or focus on specific files.",
      );
    }

    // Check cost limits
    this.checkCostLimits(task.sessionId);

    // Build the full prompt
    const prompt = this.buildPrompt(task.description, context);

    logger.info("Executing Claude task", {
      taskId: task.requestId,
      project: task.projectName,
      contextTokens,
      maxTokens,
    });

    // Spawn the Claude CLI
    const result = await this.spawnClaude(prompt, projectPath);

    // Track usage
    const durationMs = Date.now() - startTime;
    const outputTokens = this.getTokenCount(result.stdout);

    this.trackUsage(task.sessionId, task.requestId, contextTokens, outputTokens);

    // Parse output
    let parsedOutput: string;
    let filesReferenced: string[] = [];

    try {
      const jsonOutput = JSON.parse(result.stdout);
      parsedOutput = this.redactor.redactContent(
        typeof jsonOutput.result === "string" ? jsonOutput.result : JSON.stringify(jsonOutput, null, 2),
      );
      if (Array.isArray(jsonOutput.files_referenced)) {
        filesReferenced = jsonOutput.files_referenced;
      }
    } catch {
      // If output is not JSON, use as-is after redaction
      parsedOutput = this.redactor.redactContent(result.stdout);
    }

    if (result.stderr) {
      logger.warn("Claude CLI stderr output", {
        taskId: task.requestId,
        stderr: this.redactor.redactContent(result.stderr).slice(0, 500),
      });
    }

    return {
      output: parsedOutput,
      tokensUsed: {
        input: contextTokens,
        output: outputTokens,
        total: contextTokens + outputTokens,
      },
      durationMs,
      filesReferenced,
    };
  }

  /**
   * Assemble context for a task by reading project manifest and relevant files.
   */
  async assembleContext(
    projectPath: string,
    taskDescription: string,
    focusFiles?: string[],
  ): Promise<string> {
    const sections: string[] = [];
    let tokenBudget = this.config.maxTokensPerTask;

    // Reserve tokens for the task prompt itself
    const promptOverhead = 2000;
    tokenBudget -= promptOverhead;

    // 1. Read project manifest if it exists
    const manifest = this.readProjectManifest(projectPath);
    if (manifest) {
      const manifestSection = `## Project: ${manifest.name}\n${manifest.description ?? ""}\n`;
      const manifestTokens = this.getTokenCount(manifestSection);
      if (manifestTokens < tokenBudget) {
        sections.push(manifestSection);
        tokenBudget -= manifestTokens;
      }
    }

    // 2. Read always-include files from manifest
    if (manifest?.alwaysInclude) {
      for (const pattern of manifest.alwaysInclude) {
        const filePath = path.join(projectPath, pattern);
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const content = this.safeReadFile(filePath);
          if (content) {
            const section = `## File: ${pattern}\n\`\`\`\n${content}\n\`\`\`\n`;
            const tokens = this.getTokenCount(section);
            if (tokens < tokenBudget) {
              sections.push(section);
              tokenBudget -= tokens;
            }
          }
        }
      }
    }

    // 3. Read focus files (explicitly requested)
    if (focusFiles) {
      for (const relPath of focusFiles) {
        const filePath = path.join(projectPath, relPath);
        if (existsSync(filePath) && statSync(filePath).isFile()) {
          const content = this.safeReadFile(filePath);
          if (content) {
            const section = `## File: ${relPath}\n\`\`\`\n${content}\n\`\`\`\n`;
            const tokens = this.getTokenCount(section);
            if (tokens < tokenBudget) {
              sections.push(section);
              tokenBudget -= tokens;
            }
          }
        }
      }
    }

    // 4. Score and include relevant files based on task keywords
    const keywords = this.extractKeywords(taskDescription);
    const scoredFiles = this.scoreFiles(projectPath, keywords, manifest);

    for (const sf of scoredFiles) {
      if (tokenBudget <= 0) break;

      const content = this.safeReadFile(sf.absolutePath);
      if (!content) continue;

      const section = `## File: ${sf.relativePath}\n\`\`\`\n${content}\n\`\`\`\n`;
      const tokens = this.getTokenCount(section);
      if (tokens < tokenBudget) {
        sections.push(section);
        tokenBudget -= tokens;
      }
    }

    const assembled = sections.join("\n");
    return this.redactor.redactContent(assembled);
  }

  /**
   * Count tokens in a text string using tiktoken.
   */
  getTokenCount(text: string): number {
    try {
      const encoder = getTokenEncoder();
      const tokens = encoder.encode(text);
      return tokens.length;
    } catch (err) {
      logger.warn("Token counting failed, using heuristic", { error: err });
      // Fallback heuristic: ~4 chars per token
      return Math.ceil(text.length / 4);
    }
  }

  /**
   * Check whether session and daily cost limits have been exceeded.
   * Throws if limits are breached.
   */
  checkCostLimits(sessionId: string): void {
    const sessionSummary = this.getSessionUsage(sessionId);
    if (sessionSummary.totalTasks >= this.config.maxTasksPerSession) {
      throw new Error(
        `Session task limit reached: ${sessionSummary.totalTasks}/${this.config.maxTasksPerSession}`,
      );
    }

    const dailySummary = this.getDailyUsage();
    if (dailySummary.totalTokens >= this.config.dailySpendThreshold) {
      throw new Error(
        `Daily token limit reached: ${dailySummary.totalTokens}/${this.config.dailySpendThreshold}`,
      );
    }
  }

  /**
   * Record token usage for a completed task.
   */
  trackUsage(
    sessionId: string,
    taskId: string,
    inputTokens: number,
    outputTokens: number,
  ): void {
    this.usageRecords.push({
      sessionId,
      taskId,
      inputTokens,
      outputTokens,
      timestamp: new Date().toISOString(),
    });

    logger.info("Token usage recorded", {
      sessionId,
      taskId,
      inputTokens,
      outputTokens,
      total: inputTokens + outputTokens,
    });
  }

  /**
   * Get aggregated usage for a session.
   */
  getSessionUsage(sessionId: string): SessionUsageSummary {
    const records = this.usageRecords.filter((r) => r.sessionId === sessionId);
    const totalInput = records.reduce((s, r) => s + r.inputTokens, 0);
    const totalOutput = records.reduce((s, r) => s + r.outputTokens, 0);

    return {
      sessionId,
      totalTasks: records.length,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalTokens: totalInput + totalOutput,
    };
  }

  /**
   * Get aggregated usage for the current day.
   */
  getDailyUsage(): DailyUsageSummary {
    const today = new Date().toISOString().slice(0, 10);
    const records = this.usageRecords.filter((r) => r.timestamp.startsWith(today));
    const totalTokens = records.reduce(
      (s, r) => s + r.inputTokens + r.outputTokens,
      0,
    );

    return {
      date: today,
      totalTokens,
      totalTasks: records.length,
    };
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private buildPrompt(taskDescription: string, context: string): string {
    return [
      "You are an expert software engineer assisting with a development task.",
      "Below is the project context and the task description.",
      "",
      "# Context",
      context,
      "",
      "# Task",
      taskDescription,
      "",
      "Provide a clear, actionable response. If you reference files, use relative paths from the project root.",
    ].join("\n");
  }

  private spawnClaude(
    prompt: string,
    cwd: string,
  ): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve, reject) => {
      const timeoutMs = this.config.claudeTaskTimeoutMs;
      let stdout = "";
      let stderr = "";
      let killed = false;

      const child = spawn(
        this.config.claudeCliPath,
        ["--print", "--output-format", "json"],
        {
          cwd,
          stdio: ["pipe", "pipe", "pipe"],
          env: { ...process.env },
          // On Windows, use shell: false to avoid injection
          shell: false,
          windowsHide: true,
        },
      );

      const timer = setTimeout(() => {
        killed = true;
        child.kill("SIGTERM");
        // Force kill after 5 seconds if still running
        setTimeout(() => {
          if (!child.killed) child.kill("SIGKILL");
        }, 5_000);
      }, timeoutMs);

      child.stdout.on("data", (chunk: Buffer) => {
        stdout += chunk.toString("utf-8");
      });

      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString("utf-8");
      });

      child.on("error", (err) => {
        clearTimeout(timer);
        reject(new Error(`Failed to spawn Claude CLI: ${err.message}`));
      });

      child.on("close", (code) => {
        clearTimeout(timer);

        if (killed) {
          reject(new Error(`Claude CLI timed out after ${timeoutMs}ms`));
          return;
        }

        resolve({
          stdout,
          stderr,
          exitCode: code ?? 1,
        });
      });

      // Write the prompt to stdin and close it
      child.stdin.write(prompt, "utf-8");
      child.stdin.end();
    });
  }

  private readProjectManifest(projectPath: string): ProjectManifest | null {
    const manifestPath = path.join(projectPath, ".sovereign-manifest.json");
    if (!existsSync(manifestPath)) return null;

    try {
      const raw = readFileSync(manifestPath, "utf-8");
      return JSON.parse(raw) as ProjectManifest;
    } catch (err) {
      logger.warn("Failed to read project manifest", {
        path: manifestPath,
        error: err,
      });
      return null;
    }
  }

  private extractKeywords(text: string): string[] {
    // Tokenize on whitespace and common delimiters, lowercase, deduplicate
    const words = text
      .toLowerCase()
      .split(/[\s,.:;!?()[\]{}"'`]+/)
      .filter((w) => w.length > 2);
    return [...new Set(words)];
  }

  private scoreFiles(
    projectPath: string,
    keywords: string[],
    manifest: ProjectManifest | null,
  ): Array<{ relativePath: string; absolutePath: string; score: number }> {
    const results: Array<{
      relativePath: string;
      absolutePath: string;
      score: number;
    }> = [];

    const excludePatterns = new Set([
      "node_modules",
      ".git",
      "dist",
      "build",
      ".next",
      "__pycache__",
      ".venv",
      "vendor",
      ...(manifest?.alwaysExclude ?? []),
    ]);

    const walk = (dir: string, rel: string, depth: number): void => {
      if (depth > 5) return; // Limit recursion depth

      let entries;
      try {
        entries = readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (excludePatterns.has(entry.name)) continue;
        if (entry.name.startsWith(".")) continue;

        const absPath = path.join(dir, entry.name);
        const relPath = path.join(rel, entry.name);

        if (entry.isDirectory()) {
          walk(absPath, relPath, depth + 1);
        } else if (entry.isFile()) {
          // Score by filename match and extension relevance
          let score = 0;
          const nameLower = entry.name.toLowerCase();
          const relLower = relPath.toLowerCase();

          for (const kw of keywords) {
            if (nameLower.includes(kw)) score += 3;
            else if (relLower.includes(kw)) score += 1;
          }

          // Boost common entry-point files
          if (/^(index|main|app|server|readme)\./i.test(entry.name)) {
            score += 2;
          }

          // Boost configuration files
          if (/^(package\.json|tsconfig\.json|cargo\.toml|pyproject\.toml)$/i.test(entry.name)) {
            score += 2;
          }

          if (score > 0) {
            results.push({ relativePath: relPath, absolutePath: absPath, score });
          }
        }
      }
    };

    walk(projectPath, "", 0);

    // Sort by score descending
    results.sort((a, b) => b.score - a.score);

    return results;
  }

  private safeReadFile(filePath: string): string | null {
    try {
      const stat = statSync(filePath);
      // Skip files > 1MB
      if (stat.size > 1_048_576) return null;

      // Skip binary files (heuristic: check first 512 bytes for null bytes)
      const content = readFileSync(filePath, "utf-8");
      if (content.slice(0, 512).includes("\0")) return null;

      return content;
    } catch {
      return null;
    }
  }
}
