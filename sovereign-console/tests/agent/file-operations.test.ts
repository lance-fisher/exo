// =============================================================================
// Sovereign Operator Console — File Operation Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECTS_ROOT = '/home/user/projects';
const MAX_READ_BYTES = 1 * 1024 * 1024; // 1 MB read limit
const TRUNCATION_MARKER = '\n--- [TRUNCATED: file exceeds 1 MB read limit] ---';

// ---------------------------------------------------------------------------
// Simulated filesystem
// ---------------------------------------------------------------------------

interface FsEntry {
  type: 'file' | 'directory';
  content?: string;
  size?: number;
  children?: string[];
}

let mockFs: Map<string, FsEntry>;
let approvalTokens: Set<string>;

function seedFilesystem(): void {
  mockFs = new Map([
    [
      '/home/user/projects/myapp',
      { type: 'directory', children: ['src', 'package.json', '.env'] },
    ],
    [
      '/home/user/projects/myapp/src',
      { type: 'directory', children: ['index.ts', 'config.ts', 'db.ts'] },
    ],
    [
      '/home/user/projects/myapp/src/index.ts',
      {
        type: 'file',
        content: 'import { app } from "./app";\napp.listen(3000);\n',
        size: 48,
      },
    ],
    [
      '/home/user/projects/myapp/src/config.ts',
      {
        type: 'file',
        content:
          'export const DB_URL = "postgresql://user:s3cretP@ss@db.example.com:5432/prod";\nexport const API_KEY = "sk-proj-abc123def456ghi789";\n',
        size: 130,
      },
    ],
    [
      '/home/user/projects/myapp/src/db.ts',
      {
        type: 'file',
        content: 'import pg from "pg";\nconst pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });\nexport default pool;\n',
        size: 115,
      },
    ],
    [
      '/home/user/projects/myapp/package.json',
      {
        type: 'file',
        content: '{"name": "myapp", "version": "1.0.0"}',
        size: 38,
      },
    ],
    [
      '/home/user/projects/myapp/.env',
      {
        type: 'file',
        content: 'DATABASE_URL=postgresql://user:password@localhost/dev\nAPI_KEY=sk-live-supersecret\n',
        size: 80,
      },
    ],
  ]);
}

// ---------------------------------------------------------------------------
// Secret redaction (inline for file-op tests; full suite in redaction tests)
// ---------------------------------------------------------------------------

const SECRET_PATTERNS = [
  { name: 'api_key', pattern: /(?:sk-(?:proj-|live-|test-))[a-zA-Z0-9]{10,}/g, replacement: '[REDACTED:api_key]' },
  { name: 'password_in_url', pattern: /(:\/\/[^:]+:)[^@]+(@)/g, replacement: '$1[REDACTED]$2' },
  { name: 'bearer', pattern: /(Bearer\s+)[a-zA-Z0-9._-]{20,}/gi, replacement: '$1[REDACTED:bearer]' },
  { name: 'env_value', pattern: /^([A-Z_]+=)(.+)$/gm, replacement: '$1[REDACTED:env_value]' },
];

function redactSecrets(content: string): string {
  let redacted = content;
  for (const { pattern, replacement } of SECRET_PATTERNS) {
    // Reset regex state for global patterns
    const regex = new RegExp(pattern.source, pattern.flags);
    redacted = redacted.replace(regex, replacement);
  }
  return redacted;
}

// ---------------------------------------------------------------------------
// Stub file operations
// ---------------------------------------------------------------------------

function browse(dirPath: string): { entries: string[]; error?: string } {
  const normalized = dirPath.replace(/\\/g, '/');
  if (!normalized.startsWith(PROJECTS_ROOT)) {
    return { entries: [], error: 'outside_project_scope' };
  }
  const entry = mockFs.get(normalized);
  if (!entry || entry.type !== 'directory') {
    return { entries: [], error: 'not_a_directory' };
  }
  return { entries: entry.children ?? [] };
}

function readFile(
  filePath: string,
  options?: { redact?: boolean },
): { content: string; truncated: boolean; error?: string } {
  const normalized = filePath.replace(/\\/g, '/');
  if (!normalized.startsWith(PROJECTS_ROOT)) {
    return { content: '', truncated: false, error: 'outside_project_scope' };
  }
  const entry = mockFs.get(normalized);
  if (!entry || entry.type !== 'file') {
    return { content: '', truncated: false, error: 'file_not_found' };
  }

  let content = entry.content ?? '';
  let truncated = false;

  if ((entry.size ?? content.length) > MAX_READ_BYTES) {
    content = content.slice(0, MAX_READ_BYTES) + TRUNCATION_MARKER;
    truncated = true;
  }

  if (options?.redact !== false) {
    content = redactSecrets(content);
  }

  return { content, truncated };
}

function generateDiff(
  oldContent: string,
  newContent: string,
  options?: { redact?: boolean },
): string {
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  let diff = '';
  const maxLen = Math.max(oldLines.length, newLines.length);

  for (let i = 0; i < maxLen; i++) {
    const oldLine = oldLines[i];
    const newLine = newLines[i];

    if (oldLine === undefined) {
      diff += `+ ${newLine}\n`;
    } else if (newLine === undefined) {
      diff += `- ${oldLine}\n`;
    } else if (oldLine !== newLine) {
      diff += `- ${oldLine}\n`;
      diff += `+ ${newLine}\n`;
    } else {
      diff += `  ${oldLine}\n`;
    }
  }

  if (options?.redact !== false) {
    diff = redactSecrets(diff);
  }

  return diff;
}

function writeFile(
  filePath: string,
  content: string,
  approvalTokenId: string | null,
): { success: boolean; error?: string } {
  const normalized = filePath.replace(/\\/g, '/');

  if (!normalized.startsWith(PROJECTS_ROOT)) {
    return { success: false, error: 'outside_project_scope' };
  }

  const isProtected = /\.(env|key|pem)$/.test(normalized) || /credentials\.json$/.test(normalized);
  if (isProtected) {
    return { success: false, error: 'protected_path' };
  }

  if (!approvalTokenId) {
    return { success: false, error: 'approval_token_required' };
  }

  if (!approvalTokens.has(approvalTokenId)) {
    return { success: false, error: 'invalid_approval_token' };
  }

  // Consume the token (single-use)
  approvalTokens.delete(approvalTokenId);

  mockFs.set(normalized, { type: 'file', content, size: content.length });
  return { success: true };
}

function normalizePath(inputPath: string): string {
  return inputPath.replace(/\\/g, '/').replace(/\/+/g, '/');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('File Operations — Browse', () => {
  beforeEach(() => {
    seedFilesystem();
    approvalTokens = new Set(['tok-valid-001']);
  });

  it('returns directory listing within scope', () => {
    const result = browse('/home/user/projects/myapp');
    expect(result.error).toBeUndefined();
    expect(result.entries).toContain('src');
    expect(result.entries).toContain('package.json');
  });

  it('rejects browsing outside scope', () => {
    const result = browse('/etc');
    expect(result.error).toBe('outside_project_scope');
    expect(result.entries).toEqual([]);
  });
});

describe('File Operations — Read', () => {
  beforeEach(() => {
    seedFilesystem();
    approvalTokens = new Set();
  });

  it('returns file content', () => {
    const result = readFile('/home/user/projects/myapp/package.json');
    expect(result.error).toBeUndefined();
    expect(result.content).toContain('myapp');
    expect(result.truncated).toBe(false);
  });

  it('applies secret redaction by default', () => {
    const result = readFile('/home/user/projects/myapp/src/config.ts');
    expect(result.content).not.toContain('s3cretP@ss');
    expect(result.content).toContain('[REDACTED]');
    expect(result.content).not.toContain('sk-proj-abc123def456ghi789');
    expect(result.content).toContain('[REDACTED:api_key]');
  });

  it('truncates large files', () => {
    // Add a large file
    const largeContent = 'x'.repeat(2 * 1024 * 1024);
    mockFs.set('/home/user/projects/myapp/large.ts', {
      type: 'file',
      content: largeContent,
      size: largeContent.length,
    });

    const result = readFile('/home/user/projects/myapp/large.ts');
    expect(result.truncated).toBe(true);
    expect(result.content).toContain(TRUNCATION_MARKER);
    expect(result.content.length).toBeLessThan(largeContent.length);
  });
});

describe('File Operations — Diff', () => {
  beforeEach(() => {
    seedFilesystem();
  });

  it('generates diff correctly', () => {
    const oldContent = 'line1\nline2\nline3';
    const newContent = 'line1\nline2-modified\nline3\nline4';
    const diff = generateDiff(oldContent, newContent, { redact: false });

    expect(diff).toContain('  line1');
    expect(diff).toContain('- line2');
    expect(diff).toContain('+ line2-modified');
    expect(diff).toContain('+ line4');
  });

  it('applies secret redaction to both sides of diff', () => {
    const oldContent = 'const API_KEY = "sk-proj-oldkey12345678";';
    const newContent = 'const API_KEY = "sk-proj-newkey87654321";';
    const diff = generateDiff(oldContent, newContent);

    expect(diff).not.toContain('sk-proj-oldkey12345678');
    expect(diff).not.toContain('sk-proj-newkey87654321');
    expect(diff).toContain('[REDACTED:api_key]');
  });
});

describe('File Operations — Write', () => {
  beforeEach(() => {
    seedFilesystem();
    approvalTokens = new Set(['tok-valid-001', 'tok-valid-002']);
  });

  it('succeeds with valid approval token', () => {
    const result = writeFile(
      '/home/user/projects/myapp/src/new-file.ts',
      'export const hello = "world";\n',
      'tok-valid-001',
    );
    expect(result.success).toBe(true);

    // File should exist in mock fs now
    const entry = mockFs.get('/home/user/projects/myapp/src/new-file.ts');
    expect(entry).toBeDefined();
    expect(entry!.content).toContain('hello');
  });

  it('rejected without approval token', () => {
    const result = writeFile(
      '/home/user/projects/myapp/src/new-file.ts',
      'malicious content',
      null,
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('approval_token_required');
  });

  it('rejected for protected path', () => {
    const result = writeFile(
      '/home/user/projects/myapp/.env',
      'SECRET=hacked',
      'tok-valid-001',
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('protected_path');
  });

  it('rejected for invalid approval token', () => {
    const result = writeFile(
      '/home/user/projects/myapp/src/new-file.ts',
      'content',
      'tok-FAKE',
    );
    expect(result.success).toBe(false);
    expect(result.error).toBe('invalid_approval_token');
  });
});

describe('File Operations — Path Normalization', () => {
  it('handles Windows-style backslashes', () => {
    expect(normalizePath('C:\\Users\\lance\\projects\\app\\src\\index.ts')).toBe(
      'C:/Users/lance/projects/app/src/index.ts',
    );
  });

  it('collapses duplicate slashes', () => {
    expect(normalizePath('/home/user//projects///myapp/src/index.ts')).toBe(
      '/home/user/projects/myapp/src/index.ts',
    );
  });
});
