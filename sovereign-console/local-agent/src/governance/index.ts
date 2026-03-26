// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — Governance Engine
// ─────────────────────────────────────────────────────────────────────────────

import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { createHmac } from "node:crypto";
import type { AgentConfig } from "../config.js";
import type {
  AgentCommand,
  GovernanceRules,
  GovernanceViolation,
  ApprovalToken,
} from "../types/index.js";
import { createLogger } from "../services/logger.js";

const logger = createLogger("governance");

// ── Glob-like Pattern Matching ─────────────────────────────────────────────

/**
 * Match a file path against a simple glob pattern.
 * Supports: * (any non-separator), ** (any path), ? (single char)
 */
function matchGlob(pattern: string, filePath: string): boolean {
  // Normalize separators
  const normalizedPath = filePath.replace(/\\/g, "/");
  const normalizedPattern = pattern.replace(/\\/g, "/");

  // Convert glob to regex
  let regexStr = "^";
  let i = 0;
  while (i < normalizedPattern.length) {
    const ch = normalizedPattern[i]!;
    if (ch === "*") {
      if (normalizedPattern[i + 1] === "*") {
        // ** matches any number of path segments
        if (normalizedPattern[i + 2] === "/") {
          regexStr += "(?:.*/)?";
          i += 3;
        } else {
          regexStr += ".*";
          i += 2;
        }
      } else {
        // * matches any non-separator characters
        regexStr += "[^/]*";
        i += 1;
      }
    } else if (ch === "?") {
      regexStr += "[^/]";
      i += 1;
    } else if (ch === ".") {
      regexStr += "\\.";
      i += 1;
    } else {
      regexStr += ch;
      i += 1;
    }
  }
  regexStr += "$";

  try {
    return new RegExp(regexStr, "i").test(normalizedPath);
  } catch {
    return false;
  }
}

// ── Rate Limiter ───────────────────────────────────────────────────────────

class RateLimiter {
  private readonly windowMs: number;
  private readonly maxRequests: number;
  private readonly timestamps = new Map<string, number[]>();

  constructor(maxRequests: number, windowMs = 60_000) {
    this.maxRequests = maxRequests;
    this.windowMs = windowMs;
  }

  check(sessionId: string): boolean {
    const now = Date.now();
    const windowStart = now - this.windowMs;

    let timestamps = this.timestamps.get(sessionId) ?? [];
    timestamps = timestamps.filter((t) => t > windowStart);
    this.timestamps.set(sessionId, timestamps);

    return timestamps.length < this.maxRequests;
  }

  record(sessionId: string): void {
    const timestamps = this.timestamps.get(sessionId) ?? [];
    timestamps.push(Date.now());
    this.timestamps.set(sessionId, timestamps);
  }

  /**
   * Clean up stale entries to avoid memory leaks.
   */
  cleanup(): void {
    const now = Date.now();
    const windowStart = now - this.windowMs;
    for (const [key, timestamps] of this.timestamps.entries()) {
      const active = timestamps.filter((t) => t > windowStart);
      if (active.length === 0) {
        this.timestamps.delete(key);
      } else {
        this.timestamps.set(key, active);
      }
    }
  }
}

// ── Approval Token Store (single-use enforcement) ──────────────────────────

class ApprovalTokenStore {
  /** Set of consumed token IDs */
  private readonly consumed = new Set<string>();

  /** Max age after which we prune entries (24 hours) */
  private readonly maxAgeMs = 24 * 60 * 60 * 1000;
  private readonly consumedTimestamps = new Map<string, number>();

  isConsumed(tokenId: string): boolean {
    return this.consumed.has(tokenId);
  }

  markConsumed(tokenId: string): void {
    this.consumed.add(tokenId);
    this.consumedTimestamps.set(tokenId, Date.now());
  }

  cleanup(): void {
    const cutoff = Date.now() - this.maxAgeMs;
    for (const [id, ts] of this.consumedTimestamps.entries()) {
      if (ts < cutoff) {
        this.consumed.delete(id);
        this.consumedTimestamps.delete(id);
      }
    }
  }
}

// ── Governance Engine ───────────────────────────────────────────────────────

export class GovernanceEngine {
  private readonly config: AgentConfig;
  private rules: GovernanceRules;
  private readonly rateLimiter: RateLimiter;
  private readonly tokenStore: ApprovalTokenStore;
  private cleanupTimer: ReturnType<typeof setInterval> | null = null;

  constructor(config: AgentConfig, rulesPath?: string) {
    this.config = config;
    this.rules = this.loadGovernanceRules(rulesPath);
    this.rateLimiter = new RateLimiter(this.rules.rate_limit_per_minute);
    this.tokenStore = new ApprovalTokenStore();

    // Periodic cleanup every 10 minutes
    this.cleanupTimer = setInterval(() => {
      this.rateLimiter.cleanup();
      this.tokenStore.cleanup();
    }, 10 * 60 * 1000);
  }

  /**
   * Validate a command against all governance rules.
   * Returns an array of violations (empty = allowed).
   */
  validateCommand(command: AgentCommand): GovernanceViolation[] {
    const violations: GovernanceViolation[] = [];

    // 1. Check operation is allowed
    if (!this.rules.allowed_operations.includes(command.type)) {
      violations.push({
        rule: "allowed_operations",
        message: `Operation '${command.type}' is not permitted`,
        severity: "block",
      });
    }

    // 2. Rate limiting
    if (!this.rateLimiter.check(command.sessionId)) {
      violations.push({
        rule: "rate_limit",
        message: `Rate limit exceeded: max ${this.rules.rate_limit_per_minute} requests per minute`,
        severity: "block",
      });
    }

    // 3. Path validation for file operations
    if ("projectName" in command && command.projectName) {
      if (!this.isAllowedProject(command.projectName)) {
        violations.push({
          rule: "allowed_project",
          message: `Project '${command.projectName}' is not in the allowed list`,
          severity: "block",
        });
      }
    }

    if ("filePath" in command && typeof command.filePath === "string") {
      if (this.isProtectedPath(command.filePath)) {
        violations.push({
          rule: "protected_path",
          message: `Path '${command.filePath}' matches a protected pattern`,
          severity: "block",
        });
      }
    }

    // 4. Approval token for write operations
    if (this.rules.require_approval_for.includes(command.type)) {
      if (command.type === "file_write") {
        if (!("approvalToken" in command) || !command.approvalToken) {
          violations.push({
            rule: "approval_required",
            message: "File write requires a valid approval token",
            severity: "block",
          });
        }
      }
    }

    // Record the request for rate limiting (even if there are violations,
    // to prevent brute-force attacks from bypassing rate limits)
    this.rateLimiter.record(command.sessionId);

    if (violations.length > 0) {
      logger.warn("Governance violations detected", {
        commandType: command.type,
        requestId: command.requestId,
        violations: violations.map((v) => `${v.rule}: ${v.message}`),
      });
    }

    return violations;
  }

  /**
   * Check if a path matches any protected path pattern.
   */
  isProtectedPath(filePath: string): boolean {
    const allPatterns = [...this.rules.protected_paths, ...this.config.protectedPaths];
    const normalized = filePath.replace(/\\/g, "/");

    for (const pattern of allPatterns) {
      if (matchGlob(pattern, normalized)) return true;

      // Also check against just the filename
      const fileName = path.basename(normalized);
      if (matchGlob(pattern, fileName)) return true;
    }

    return false;
  }

  /**
   * Check if a project is in the allowed list.
   */
  isAllowedProject(projectName: string): boolean {
    return this.config.allowedProjects.includes(projectName);
  }

  /**
   * Validate an approval token for a specific action.
   * Checks: structure, expiry, single-use, and device binding.
   */
  validateApprovalToken(token: ApprovalToken, action: string): void {
    // 1. Required fields
    if (
      !token.tokenId ||
      !token.action ||
      !token.sessionId ||
      !token.issuedAt ||
      !token.expiresAt ||
      !token.signature
    ) {
      throw new GovernanceError("INVALID_TOKEN", "Approval token is missing required fields");
    }

    // 2. Action must match
    if (token.action !== action) {
      throw new GovernanceError(
        "TOKEN_ACTION_MISMATCH",
        `Token action '${token.action}' does not match required action '${action}'`,
      );
    }

    // 3. TTL / expiry check
    const now = new Date();
    const expiresAt = new Date(token.expiresAt);
    if (isNaN(expiresAt.getTime())) {
      throw new GovernanceError("INVALID_TOKEN", "Token has invalid expiresAt timestamp");
    }
    if (now > expiresAt) {
      throw new GovernanceError("TOKEN_EXPIRED", "Approval token has expired");
    }

    // 4. Not-before check
    const issuedAt = new Date(token.issuedAt);
    if (isNaN(issuedAt.getTime())) {
      throw new GovernanceError("INVALID_TOKEN", "Token has invalid issuedAt timestamp");
    }
    if (now < issuedAt) {
      throw new GovernanceError("TOKEN_NOT_YET_VALID", "Approval token is not yet valid");
    }

    // 5. Single-use check
    if (this.tokenStore.isConsumed(token.tokenId)) {
      throw new GovernanceError("TOKEN_ALREADY_USED", "Approval token has already been consumed");
    }

    // 6. Signature verification (HMAC-SHA256 over canonical token fields)
    const expectedSig = this.computeTokenSignature(token);
    if (token.signature !== expectedSig) {
      logger.warn("Approval token signature mismatch", {
        tokenId: token.tokenId,
      });
      throw new GovernanceError("TOKEN_INVALID_SIGNATURE", "Approval token signature is invalid");
    }

    // Mark as consumed
    this.tokenStore.markConsumed(token.tokenId);

    logger.info("Approval token validated", {
      tokenId: token.tokenId,
      action: token.action,
      issuedBy: token.issuedBy,
    });
  }

  /**
   * Get the maximum allowed file read size in bytes.
   */
  getMaxReadSize(): number {
    return this.rules.max_file_read_size_bytes;
  }

  /**
   * Get the maximum allowed file write size in bytes.
   */
  getMaxWriteSize(): number {
    return this.rules.max_file_write_size_bytes;
  }

  /**
   * Get the loaded governance rules (read-only copy).
   */
  getRules(): Readonly<GovernanceRules> {
    return this.rules;
  }

  /**
   * Shut down periodic timers.
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = null;
    }
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  /**
   * Load governance rules from a JSON file. Falls back to defaults if
   * the file is missing or invalid.
   */
  private loadGovernanceRules(rulesPath?: string): GovernanceRules {
    const defaultRulesPath = path.resolve(
      import.meta.dirname ?? path.dirname(new URL(import.meta.url).pathname),
      "rules.json",
    );

    const targetPath = rulesPath ?? defaultRulesPath;

    try {
      if (existsSync(targetPath)) {
        const raw = readFileSync(targetPath, "utf-8");
        const parsed = JSON.parse(raw) as GovernanceRules;
        logger.info("Governance rules loaded", { path: targetPath });
        return parsed;
      }
    } catch (err) {
      logger.error("Failed to load governance rules, using defaults", {
        path: targetPath,
        error: err,
      });
    }

    // Fallback defaults
    return {
      protected_paths: [
        ".env*",
        "*.key",
        "*.pem",
        "*.p12",
        ".git/config",
        "credentials*",
        "**/secrets/**",
        "**/node_modules/**",
      ],
      allowed_operations: [
        "file_read",
        "file_browse",
        "file_diff",
        "file_write",
        "task",
        "project_list",
        "status",
      ],
      max_file_read_size_bytes: 1_048_576,
      max_file_write_size_bytes: 524_288,
      max_tasks_per_session: 20,
      max_tokens_per_task: 50_000,
      rate_limit_per_minute: 30,
      require_approval_for: ["file_write", "task"],
    };
  }

  /**
   * Compute HMAC-SHA256 signature over canonical token fields.
   */
  private computeTokenSignature(token: ApprovalToken): string {
    const canonical = [
      token.tokenId,
      token.action,
      token.resourcePath,
      token.sessionId,
      token.issuedAt,
      token.expiresAt,
      token.issuedBy,
      token.deviceFingerprint,
    ].join("|");

    return createHmac("sha256", this.config.agentSecret)
      .update(canonical)
      .digest("hex");
  }
}

// ── Error Class ─────────────────────────────────────────────────────────────

export class GovernanceError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "GovernanceError";
    this.code = code;
  }
}
