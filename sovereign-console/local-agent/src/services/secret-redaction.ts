// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — Secret Redaction Engine
// ─────────────────────────────────────────────────────────────────────────────

import type { SecretPattern } from "../types/index.js";
import { createLogger } from "./logger.js";

const logger = createLogger("secret-redaction");

// ── Built-in Secret Patterns ────────────────────────────────────────────────

const BUILTIN_PATTERNS: SecretPattern[] = [
  // Generic key=value secrets
  {
    name: "generic-secret-assignment",
    pattern:
      /(?<prefix>(?:API_KEY|API_SECRET|SECRET_KEY|SECRET|PASSWORD|PASSWD|PWD|TOKEN|ACCESS_TOKEN|REFRESH_TOKEN|AUTH_TOKEN|PRIVATE_KEY|ENCRYPTION_KEY|SIGNING_KEY|CLIENT_SECRET|APP_SECRET)\s*[=:]\s*)(?<value>\S+)/gi,
    replacement: "$<prefix>[REDACTED]",
  },

  // Bearer tokens in headers
  {
    name: "bearer-token",
    pattern: /(?<prefix>Bearer\s+)(?<token>[A-Za-z0-9\-._~+/]+=*)/gi,
    replacement: "$<prefix>[REDACTED]",
  },

  // AWS access keys
  {
    name: "aws-access-key-id",
    pattern:
      /(?<prefix>aws_access_key_id\s*[=:]\s*)(?<key>AKIA[0-9A-Z]{16})/gi,
    replacement: "$<prefix>[REDACTED]",
  },
  {
    name: "aws-secret-access-key",
    pattern:
      /(?<prefix>aws_secret_access_key\s*[=:]\s*)(?<key>[A-Za-z0-9/+=]{40})/gi,
    replacement: "$<prefix>[REDACTED]",
  },

  // AWS inline key patterns
  {
    name: "aws-access-key-inline",
    pattern: /\b(?<key>AKIA[0-9A-Z]{16})\b/g,
  },

  // Private key blocks
  {
    name: "private-key-block",
    pattern:
      /-----BEGIN\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----[\s\S]*?-----END\s+(?:RSA\s+|EC\s+|DSA\s+|OPENSSH\s+)?PRIVATE\s+KEY-----/g,
    replacement: "[REDACTED PRIVATE KEY]",
  },

  // Connection strings with passwords
  {
    name: "connection-string-password",
    pattern:
      /(?<prefix>(?:mongodb|postgres|postgresql|mysql|mssql|redis|amqp|amqps):\/\/[^:]+:)(?<password>[^@]+)(?<suffix>@)/gi,
    replacement: "$<prefix>[REDACTED]$<suffix>",
  },

  // Generic connection strings
  {
    name: "jdbc-connection-string",
    pattern:
      /(?<prefix>(?:password|pwd)\s*=\s*)(?<password>[^;&\s]+)/gi,
    replacement: "$<prefix>[REDACTED]",
  },

  // GitHub / GitLab tokens
  {
    name: "github-token",
    pattern: /\b(?<token>gh[ps]_[A-Za-z0-9_]{36,})\b/g,
  },
  {
    name: "github-fine-grained-token",
    pattern: /\b(?<token>github_pat_[A-Za-z0-9_]{22,})\b/g,
  },
  {
    name: "gitlab-token",
    pattern: /\b(?<token>glpat-[A-Za-z0-9\-_]{20,})\b/g,
  },

  // Slack tokens
  {
    name: "slack-token",
    pattern: /\b(?<token>xox[bpors]-[A-Za-z0-9\-]+)\b/g,
  },

  // Stripe keys
  {
    name: "stripe-key",
    pattern: /\b(?<token>(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,})\b/g,
  },

  // npm tokens
  {
    name: "npm-token",
    pattern: /\b(?<token>npm_[A-Za-z0-9]{36})\b/g,
  },

  // .env file values (key=value where key looks secret-ish)
  {
    name: "dotenv-secret-value",
    pattern:
      /^(?<key>(?:[A-Z_]*(?:SECRET|KEY|TOKEN|PASSWORD|CREDENTIAL|AUTH)[A-Z_]*))\s*=\s*(?<value>.+)$/gm,
    replacement: "$<key>=[REDACTED]",
  },
];

// ── High-Entropy Detection ─────────────────────────────────────────────────

/**
 * Calculate Shannon entropy of a string. Values above ~4.5 for strings > 32
 * chars are likely base64-encoded secrets or random tokens.
 */
function shannonEntropy(str: string): number {
  const freq = new Map<string, number>();
  for (const ch of str) {
    freq.set(ch, (freq.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of freq.values()) {
    const p = count / str.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

/**
 * Detect high-entropy strings that look like encoded secrets.
 */
const HIGH_ENTROPY_PATTERN: SecretPattern = {
  name: "high-entropy-string",
  pattern: /\b[A-Za-z0-9+/=_\-]{32,}\b/g,
};

/**
 * Common secret patterns that should be caught regardless of entropy.
 * These match structural patterns of known API key and token formats.
 */
const ADDITIONAL_SECRET_HEURISTICS: SecretPattern[] = [
  // Generic API key patterns (prefix + long alphanumeric)
  {
    name: "generic-api-key",
    pattern: /\b(?:api|app|access|auth|client|consumer|service)[-_]?(?:key|token|secret)[-_]?[=: ]["']?([A-Za-z0-9\-._~+/]{20,})["']?/gi,
  },
  // Hex-encoded secrets (64 chars = 256-bit key, 128 chars = 512-bit)
  {
    name: "hex-encoded-secret",
    pattern: /\b(?:0x)?[0-9a-fA-F]{64,}\b/g,
  },
  // Base64-encoded blocks that are likely keys (44+ chars ending with =)
  {
    name: "base64-padded-secret",
    pattern: /\b[A-Za-z0-9+/]{43,}={1,2}\b/g,
  },
  // Private key hex (common in crypto wallets)
  {
    name: "private-key-hex",
    pattern: /\b(?:private[-_]?key\s*[=:]\s*)(?:0x)?[0-9a-fA-F]{64}\b/gi,
  },
];

// ── Redaction Service ───────────────────────────────────────────────────────

export class SecretRedactionService {
  private readonly patterns: SecretPattern[];
  private readonly entropyThreshold: number;
  private readonly minEntropyLength: number;
  private redactionCount = 0;

  constructor(
    additionalPatterns: SecretPattern[] = [],
    entropyThreshold = 4.0,
    minEntropyLength = 24,
  ) {
    this.patterns = [...BUILTIN_PATTERNS, ...ADDITIONAL_SECRET_HEURISTICS, ...additionalPatterns];
    this.entropyThreshold = entropyThreshold;
    this.minEntropyLength = minEntropyLength;
  }

  /**
   * Redact secrets from arbitrary text content (file contents, logs, etc.).
   */
  redactContent(content: string): string {
    let redacted = content;

    for (const sp of this.patterns) {
      const regex = new RegExp(sp.pattern.source, sp.pattern.flags);
      redacted = redacted.replace(regex, (match, ..._args) => {
        this.redactionCount++;
        if (sp.replacement) {
          // Use the replacement pattern (supports named groups via $<name>)
          return match.replace(new RegExp(sp.pattern.source, sp.pattern.flags), sp.replacement);
        }
        return "[REDACTED]";
      });
    }

    // High-entropy string detection
    const entropyRegex = new RegExp(
      HIGH_ENTROPY_PATTERN.pattern.source,
      HIGH_ENTROPY_PATTERN.pattern.flags,
    );
    redacted = redacted.replace(entropyRegex, (match) => {
      if (match.length >= this.minEntropyLength) {
        const entropy = shannonEntropy(match);
        if (entropy >= this.entropyThreshold) {
          // Heuristic: skip things that look like normal code identifiers,
          // file paths, or common base64 data URIs
          if (this.looksLikeCode(match)) return match;
          this.redactionCount++;
          logger.debug("High-entropy redaction triggered", {
            length: match.length,
            entropy: entropy.toFixed(2),
          });
          return "[REDACTED]";
        }
      }
      return match;
    });

    return redacted;
  }

  /**
   * Redact secrets from a unified diff. Processes BOTH sides (old and new)
   * of the diff to ensure nothing leaks even in removed lines.
   */
  redactDiff(diffOutput: string): string {
    // Process the diff line-by-line so we preserve diff structure
    const lines = diffOutput.split("\n");
    const redactedLines = lines.map((line) => {
      // Redact content of context lines, additions, and deletions
      if (
        line.startsWith("+") ||
        line.startsWith("-") ||
        line.startsWith(" ")
      ) {
        const prefix = line[0]!;
        const rest = line.slice(1);
        return prefix + this.redactContent(rest);
      }
      // Leave diff headers and hunk markers untouched
      return line;
    });
    return redactedLines.join("\n");
  }

  /**
   * Return the total number of redactions applied since construction.
   */
  getRedactionCount(): number {
    return this.redactionCount;
  }

  /**
   * Reset the redaction counter.
   */
  resetCount(): void {
    this.redactionCount = 0;
  }

  // ── Private helpers ─────────────────────────────────────────────────────

  /**
   * Heuristic to skip strings that look like normal code constructs
   * rather than secrets (class names, hashes in CSS, base64 data URIs, etc.)
   */
  private looksLikeCode(value: string): boolean {
    // Pure hex (e.g. git commit hashes, CSS colors)
    if (/^[0-9a-fA-F]+$/.test(value)) return true;
    // Looks like a camelCase or PascalCase identifier
    if (/^[a-z][a-zA-Z0-9]*$/.test(value)) return true;
    // Looks like a UUID
    if (
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        value,
      )
    )
      return true;
    // Repeated character (not a secret)
    if (new Set(value).size <= 3) return true;
    return false;
  }
}
