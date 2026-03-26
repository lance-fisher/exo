// ─────────────────────────────────────────────────────────────────────────────
// Sovereign Console Local Agent — File Operations Service
// ─────────────────────────────────────────────────────────────────────────────

import {
  readFileSync,
  writeFileSync,
  readdirSync,
  statSync,
  existsSync,
  realpathSync,
  mkdirSync,
} from "node:fs";
import path from "node:path";
import * as Diff from "diff";
import { lookup } from "node:dns";
import type { AgentConfig } from "../config.js";
import type {
  FileContent,
  DirectoryListing,
  DirectoryEntry,
  DiffResult,
  FileWriteResult,
  ApprovalToken,
} from "../types/index.js";
import { SecretRedactionService } from "./secret-redaction.js";
import { GovernanceEngine } from "../governance/index.js";
import { createLogger } from "./logger.js";

const logger = createLogger("file-operations");

// ── Service ─────────────────────────────────────────────────────────────────

export class FileOperationsService {
  private readonly config: AgentConfig;
  private readonly redactor: SecretRedactionService;
  private readonly governance: GovernanceEngine;

  constructor(
    config: AgentConfig,
    redactor: SecretRedactionService,
    governance: GovernanceEngine,
  ) {
    this.config = config;
    this.redactor = redactor;
    this.governance = governance;
  }

  // ── Public API ──────────────────────────────────────────────────────────

  /**
   * List directory contents within the scoped project path.
   */
  browseDirectory(
    projectName: string,
    relativePath: string,
    depth = 1,
  ): DirectoryListing {
    const projectPath = this.resolveProjectPath(projectName);
    const targetPath = this.resolveAndValidatePath(projectPath, relativePath);

    // Check governance for protected paths (same check used in readFile/writeFile)
    if (this.governance.isProtectedPath(relativePath)) {
      throw new FileOperationError(
        "PROTECTED_PATH",
        `Access denied: ${relativePath} is a protected path`,
      );
    }

    const stat = statSync(targetPath);
    if (!stat.isDirectory()) {
      throw new FileOperationError("NOT_DIRECTORY", `${relativePath} is not a directory`);
    }

    const entries = this.listEntries(targetPath, depth);

    logger.info("Directory browsed", {
      project: projectName,
      path: relativePath,
      entries: entries.length,
    });

    return {
      path: relativePath || ".",
      entries,
      totalEntries: entries.length,
    };
  }

  /**
   * Read a file with secret redaction applied.
   */
  readFile(
    projectName: string,
    filePath: string,
    startLine?: number,
    endLine?: number,
  ): FileContent {
    const projectPath = this.resolveProjectPath(projectName);
    const absolutePath = this.resolveAndValidatePath(projectPath, filePath);

    // Check governance for protected paths
    if (this.governance.isProtectedPath(filePath)) {
      throw new FileOperationError(
        "PROTECTED_PATH",
        `Access denied: ${filePath} is a protected path`,
      );
    }

    const stat = statSync(absolutePath);
    if (!stat.isFile()) {
      throw new FileOperationError("NOT_FILE", `${filePath} is not a file`);
    }

    // Enforce read size limit
    const maxReadSize = this.governance.getMaxReadSize();
    if (stat.size > maxReadSize) {
      throw new FileOperationError(
        "FILE_TOO_LARGE",
        `File is ${stat.size} bytes, exceeds ${maxReadSize} byte read limit`,
      );
    }

    let content = readFileSync(absolutePath, "utf-8");
    let truncated = false;

    // Apply line range if specified
    if (startLine !== undefined || endLine !== undefined) {
      const lines = content.split("\n");
      const start = Math.max(0, (startLine ?? 1) - 1);
      const end = Math.min(lines.length, endLine ?? lines.length);
      content = lines.slice(start, end).join("\n");
      truncated = true;
    }

    // Redact secrets
    content = this.redactor.redactContent(content);

    const lineCount = content.split("\n").length;
    const mimeType = this.guessMimeType(filePath);

    logger.info("File read", {
      project: projectName,
      path: filePath,
      size: stat.size,
      truncated,
    });

    return {
      filePath,
      content,
      sizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
      mimeType,
      lineCount,
      truncated,
    };
  }

  /**
   * Generate a diff between the current file content and proposed content.
   * Both sides are redacted to prevent secret leakage.
   */
  generateDiff(
    projectName: string,
    filePath: string,
    proposedContent: string,
  ): DiffResult {
    const projectPath = this.resolveProjectPath(projectName);
    const absolutePath = this.resolveAndValidatePath(projectPath, filePath);

    let currentContent = "";
    let isNewFile = false;

    if (existsSync(absolutePath)) {
      currentContent = readFileSync(absolutePath, "utf-8");
    } else {
      isNewFile = true;
    }

    // Generate unified diff
    const rawDiff = Diff.createTwoFilesPatch(
      `a/${filePath}`,
      `b/${filePath}`,
      currentContent,
      proposedContent,
      undefined,
      undefined,
      { context: 3 },
    );

    // Redact BOTH sides
    const diff = this.redactor.redactDiff(rawDiff);

    // Count added/removed lines
    let linesAdded = 0;
    let linesRemoved = 0;
    for (const line of diff.split("\n")) {
      if (line.startsWith("+") && !line.startsWith("+++")) linesAdded++;
      if (line.startsWith("-") && !line.startsWith("---")) linesRemoved++;
    }

    logger.info("Diff generated", {
      project: projectName,
      path: filePath,
      isNewFile,
      linesAdded,
      linesRemoved,
    });

    return { filePath, diff, linesAdded, linesRemoved, isNewFile };
  }

  /**
   * Write a file after validating the approval token and governance rules.
   */
  writeFile(
    projectName: string,
    filePath: string,
    content: string,
    approvalToken: ApprovalToken,
  ): FileWriteResult {
    const projectPath = this.resolveProjectPath(projectName);
    const absolutePath = this.resolveAndValidatePath(projectPath, filePath);

    // Check governance for protected paths
    if (this.governance.isProtectedPath(filePath)) {
      throw new FileOperationError(
        "PROTECTED_PATH",
        `Write denied: ${filePath} is a protected path`,
      );
    }

    // Validate approval token
    this.governance.validateApprovalToken(approvalToken, "file_write");

    // Enforce write size limit
    const maxWriteSize = this.governance.getMaxWriteSize();
    const contentSize = Buffer.byteLength(content, "utf-8");
    if (contentSize > maxWriteSize) {
      throw new FileOperationError(
        "FILE_TOO_LARGE",
        `Content is ${contentSize} bytes, exceeds ${maxWriteSize} byte write limit`,
      );
    }

    // Ensure parent directory exists
    const parentDir = path.dirname(absolutePath);
    if (!existsSync(parentDir)) {
      mkdirSync(parentDir, { recursive: true });
    }

    // Write the file
    writeFileSync(absolutePath, content, "utf-8");

    const timestamp = new Date().toISOString();

    logger.info("File written", {
      project: projectName,
      path: filePath,
      bytesWritten: contentSize,
      approvalTokenId: approvalToken.tokenId,
    });

    return {
      filePath,
      bytesWritten: contentSize,
      timestamp,
    };
  }

  /**
   * List allowed projects in PROJECTS_ROOT.
   */
  listProjects(): Array<{ name: string; exists: boolean }> {
    return this.config.allowedProjects.map((name) => {
      const projectPath = path.join(this.config.projectsRoot, name);
      return {
        name,
        exists: existsSync(projectPath),
      };
    });
  }

  /**
   * Get metadata for a file.
   */
  getFileMetadata(
    projectName: string,
    filePath: string,
  ): { sizeBytes: number; lastModified: string; type: string } {
    const projectPath = this.resolveProjectPath(projectName);
    const absolutePath = this.resolveAndValidatePath(projectPath, filePath);

    const stat = statSync(absolutePath);
    return {
      sizeBytes: stat.size,
      lastModified: stat.mtime.toISOString(),
      type: stat.isFile() ? "file" : stat.isDirectory() ? "directory" : "other",
    };
  }

  // ── Path Validation ─────────────────────────────────────────────────────

  /**
   * Validate that a requested path is within the allowed project scope.
   * Resolves symlinks and junctions to prevent escape.
   */
  resolveAndValidatePath(projectPath: string, requestedPath: string): string {
    // Normalize the requested path (handle Windows separators)
    const normalized = this.normalizeWindowsPath(requestedPath);

    // Reject obvious traversal attempts before resolution
    if (normalized.includes("..")) {
      throw new FileOperationError(
        "PATH_TRAVERSAL",
        "Path traversal detected: '..' segments are not allowed",
      );
    }

    // Build absolute target path
    const target = path.resolve(projectPath, normalized);

    // Verify the target is still within the project root
    const normalizedProjectRoot = path.resolve(this.config.projectsRoot);
    const normalizedTarget = path.resolve(target);

    if (!normalizedTarget.startsWith(normalizedProjectRoot)) {
      throw new FileOperationError(
        "PATH_ESCAPE",
        "Path resolves outside of projects root",
      );
    }

    // If the path exists, resolve symlinks/junctions and re-check against
    // both the projects root and the specific project path to prevent escape
    if (existsSync(target)) {
      try {
        const realPath = realpathSync(target);
        const normalizedRealPath = path.resolve(realPath);
        if (!normalizedRealPath.startsWith(normalizedProjectRoot)) {
          throw new FileOperationError(
            "SYMLINK_ESCAPE",
            "Symlink or junction resolves outside of projects root",
          );
        }
        // Also verify the resolved path is within the specific project directory
        const normalizedProjectPath = path.resolve(projectPath);
        if (
          !normalizedRealPath.startsWith(normalizedProjectPath + path.sep) &&
          normalizedRealPath !== normalizedProjectPath
        ) {
          throw new FileOperationError(
            "SYMLINK_ESCAPE",
            "Symlink or junction resolves outside of the project directory",
          );
        }
        return realPath;
      } catch (err) {
        if (err instanceof FileOperationError) throw err;
        throw new FileOperationError(
          "PATH_RESOLUTION",
          `Failed to resolve real path: ${(err as Error).message}`,
        );
      }
    }

    return normalizedTarget;
  }

  /**
   * Normalize Windows-style paths safely.
   */
  normalizeWindowsPath(inputPath: string): string {
    // Remove any null bytes FIRST to prevent null byte injection before normalization
    let normalized = inputPath.replace(/\0/g, "");

    // Replace backslashes with forward slashes
    normalized = normalized.replace(/\\/g, "/");

    // Remove leading slash if it looks like a relative path
    if (normalized.startsWith("/") && !normalized.startsWith("//")) {
      normalized = normalized.slice(1);
    }

    // Collapse multiple slashes
    normalized = normalized.replace(/\/+/g, "/");

    // Remove trailing slash
    if (normalized.endsWith("/") && normalized.length > 1) {
      normalized = normalized.slice(0, -1);
    }

    return normalized;
  }

  // ── Private Helpers ─────────────────────────────────────────────────────

  private resolveProjectPath(projectName: string): string {
    if (!this.governance.isAllowedProject(projectName)) {
      throw new FileOperationError(
        "PROJECT_NOT_ALLOWED",
        `Project '${projectName}' is not in the allowed projects list`,
      );
    }

    const projectPath = path.join(this.config.projectsRoot, projectName);
    if (!existsSync(projectPath)) {
      throw new FileOperationError(
        "PROJECT_NOT_FOUND",
        `Project directory not found: ${projectName}`,
      );
    }

    return projectPath;
  }

  private listEntries(dirPath: string, depth: number): DirectoryEntry[] {
    const entries: DirectoryEntry[] = [];

    let dirEntries;
    try {
      dirEntries = readdirSync(dirPath, { withFileTypes: true });
    } catch (err) {
      throw new FileOperationError(
        "READ_ERROR",
        `Cannot read directory: ${(err as Error).message}`,
      );
    }

    for (const entry of dirEntries) {
      // Skip hidden files and common large directories
      if (entry.name.startsWith(".") || entry.name === "node_modules") {
        continue;
      }

      const fullPath = path.join(dirPath, entry.name);
      let stat;
      try {
        stat = statSync(fullPath);
      } catch {
        continue; // Skip inaccessible entries
      }

      // If this entry is a symlink, verify the target is within the projects root
      if (entry.isSymbolicLink()) {
        try {
          const realTarget = realpathSync(fullPath);
          const normalizedRoot = path.resolve(this.config.projectsRoot);
          if (!realTarget.startsWith(normalizedRoot)) {
            continue; // Skip symlinks that escape the allowed scope
          }
        } catch {
          continue; // Skip unresolvable symlinks
        }
      }

      const type: DirectoryEntry["type"] = entry.isSymbolicLink()
        ? "symlink"
        : entry.isDirectory()
          ? "directory"
          : "file";

      entries.push({
        name: entry.name,
        type,
        sizeBytes: stat.size,
        lastModified: stat.mtime.toISOString(),
      });
    }

    // Sort: directories first, then alphabetically
    entries.sort((a, b) => {
      if (a.type === "directory" && b.type !== "directory") return -1;
      if (a.type !== "directory" && b.type === "directory") return 1;
      return a.name.localeCompare(b.name);
    });

    return entries;
  }

  private guessMimeType(filePath: string): string {
    const ext = path.extname(filePath).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".ts": "text/typescript",
      ".tsx": "text/typescript",
      ".js": "text/javascript",
      ".jsx": "text/javascript",
      ".json": "application/json",
      ".md": "text/markdown",
      ".html": "text/html",
      ".css": "text/css",
      ".py": "text/x-python",
      ".rs": "text/x-rust",
      ".go": "text/x-go",
      ".java": "text/x-java",
      ".c": "text/x-c",
      ".cpp": "text/x-c++",
      ".h": "text/x-c",
      ".yaml": "text/yaml",
      ".yml": "text/yaml",
      ".xml": "text/xml",
      ".toml": "text/toml",
      ".sql": "text/sql",
      ".sh": "text/x-shellscript",
      ".ps1": "text/x-powershell",
      ".txt": "text/plain",
    };
    return mimeMap[ext] ?? "text/plain";
  }
}

// ── Error Class ─────────────────────────────────────────────────────────────

export class FileOperationError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = "FileOperationError";
    this.code = code;
  }
}
