// =============================================================================
// Sovereign Operator Console — Governance Policy Tests
// =============================================================================

import { describe, it, expect, beforeEach } from 'vitest';
import * as path from 'node:path';
import * as fs from 'node:fs';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PROJECTS_ROOT = '/home/user/projects';
const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024; // 5 MB

const PROTECTED_PATTERNS = [
  /\.env$/,
  /\.env\..+$/,
  /\.key$/,
  /\.pem$/,
  /id_rsa/,
  /id_ed25519/,
  /credentials\.json$/,
  /\.secret$/,
  /\.pfx$/,
  /\.p12$/,
  /service[_-]?account.*\.json$/,
];

const ALLOWED_EXTENSIONS = new Set([
  '.ts', '.tsx', '.js', '.jsx', '.json', '.md', '.css', '.scss',
  '.html', '.yaml', '.yml', '.toml', '.txt', '.sh', '.ps1',
  '.py', '.go', '.rs', '.sql', '.graphql', '.svelte', '.vue',
  '.xml', '.csv', '.lock', '.gitignore', '.dockerignore',
  '.dockerfile', '.config', '.conf',
]);

// ---------------------------------------------------------------------------
// Rate limit state
// ---------------------------------------------------------------------------

let rateLimitMap: Map<string, { count: number; windowStart: number }>;
const RATE_LIMIT_MAX = 60;
const RATE_LIMIT_WINDOW_MS = 60_000;

// ---------------------------------------------------------------------------
// Stub services
// ---------------------------------------------------------------------------

function normalizePath(inputPath: string): string {
  // Convert backslashes to forward slashes (Windows compatibility)
  let normalized = inputPath.replace(/\\/g, '/');
  // Resolve . and .. segments
  normalized = path.posix.normalize(normalized);
  return normalized;
}

function isWithinProjectScope(filePath: string): { allowed: boolean; reason?: string } {
  // Check for path traversal in the raw input (before normalization resolves
  // the .. segments away). Backslashes are converted first so that both
  // ../  and ..\  patterns are caught uniformly.
  const withForwardSlashes = filePath.replace(/\\/g, '/');
  if (/(?:^|\/)\.\.(?:\/|$)/.test(withForwardSlashes)) {
    return { allowed: false, reason: 'path_traversal_detected' };
  }

  const normalized = normalizePath(filePath);

  if (!normalized.startsWith(PROJECTS_ROOT)) {
    return { allowed: false, reason: 'outside_project_scope' };
  }

  return { allowed: true };
}

function isProtectedPath(filePath: string): boolean {
  const normalized = normalizePath(filePath);
  return PROTECTED_PATTERNS.some((pattern) => pattern.test(normalized));
}

function isAllowedExtension(filePath: string): boolean {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === '') return false; // no extension => check directory listing
  return ALLOWED_EXTENSIONS.has(ext);
}

function checkFileSize(sizeBytes: number): { allowed: boolean; reason?: string } {
  if (sizeBytes > MAX_FILE_SIZE_BYTES) {
    return { allowed: false, reason: `file_too_large: ${sizeBytes} > ${MAX_FILE_SIZE_BYTES}` };
  }
  return { allowed: true };
}

function checkRateLimit(sessionId: string): { allowed: boolean; retryAfterMs?: number } {
  const now = Date.now();
  const entry = rateLimitMap.get(sessionId);

  if (!entry || now - entry.windowStart > RATE_LIMIT_WINDOW_MS) {
    rateLimitMap.set(sessionId, { count: 1, windowStart: now });
    return { allowed: true };
  }

  if (entry.count >= RATE_LIMIT_MAX) {
    const retryAfterMs = RATE_LIMIT_WINDOW_MS - (now - entry.windowStart);
    return { allowed: false, retryAfterMs };
  }

  entry.count++;
  return { allowed: true };
}

function validateWriteRequest(params: {
  filePath: string;
  sessionId: string;
  approvalTokenId: string | null;
}): { allowed: boolean; reason?: string } {
  const scopeCheck = isWithinProjectScope(params.filePath);
  if (!scopeCheck.allowed) return scopeCheck;

  if (isProtectedPath(params.filePath)) {
    return { allowed: false, reason: 'protected_path' };
  }

  if (!params.approvalTokenId) {
    return { allowed: false, reason: 'approval_token_required' };
  }

  if (!isAllowedExtension(params.filePath)) {
    return { allowed: false, reason: 'extension_not_in_allowlist' };
  }

  return { allowed: true };
}

function resolveSymlink(filePath: string): string {
  // Simulated: in production this calls fs.realpathSync
  // For testing, we'll use a lookup table
  const symlinkMap: Record<string, string> = {
    '/home/user/projects/app/link-to-etc': '/etc/passwd',
    '/home/user/projects/app/safe-link': '/home/user/projects/app/src/real-file.ts',
  };
  return symlinkMap[filePath] ?? filePath;
}

function checkSymlinkEscape(filePath: string): { allowed: boolean; reason?: string } {
  const resolved = resolveSymlink(filePath);
  return isWithinProjectScope(resolved);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Governance — Path Scope', () => {
  it('allows path within project scope', () => {
    const result = isWithinProjectScope('/home/user/projects/myapp/src/index.ts');
    expect(result.allowed).toBe(true);
  });

  it('rejects path outside PROJECTS_ROOT', () => {
    const result = isWithinProjectScope('/etc/passwd');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('outside_project_scope');
  });

  it('rejects path traversal with ../', () => {
    const result = isWithinProjectScope('/home/user/projects/myapp/../../etc/shadow');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('path_traversal_detected');
  });

  it('rejects path traversal with ..\\', () => {
    const inputPath = '/home/user/projects/myapp/..\\..\\etc\\shadow';
    const result = isWithinProjectScope(inputPath);
    expect(result.allowed).toBe(false);
    // After normalization the backslashes become / and .. is detected
    expect(result.reason).toBe('path_traversal_detected');
  });

  it('rejects root-relative paths', () => {
    const result = isWithinProjectScope('/root/.ssh/authorized_keys');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('outside_project_scope');
  });
});

describe('Governance — Protected Paths', () => {
  it.each([
    ['/home/user/projects/myapp/.env', true],
    ['/home/user/projects/myapp/.env.production', true],
    ['/home/user/projects/myapp/certs/server.key', true],
    ['/home/user/projects/myapp/certs/ca.pem', true],
    ['/home/user/projects/myapp/credentials.json', true],
    ['/home/user/projects/myapp/id_rsa', true],
    ['/home/user/projects/myapp/id_ed25519', true],
    ['/home/user/projects/myapp/service_account.json', true],
    ['/home/user/projects/myapp/service-account-key.json', true],
    ['/home/user/projects/myapp/src/index.ts', false],
    ['/home/user/projects/myapp/package.json', false],
    ['/home/user/projects/myapp/README.md', false],
  ])('isProtectedPath(%s) => %s', (filePath, expected) => {
    expect(isProtectedPath(filePath)).toBe(expected);
  });
});

describe('Governance — Symlink Escape', () => {
  it('rejects symlink that resolves outside project scope', () => {
    const result = checkSymlinkEscape('/home/user/projects/app/link-to-etc');
    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('outside_project_scope');
  });

  it('allows symlink that stays within project scope', () => {
    const result = checkSymlinkEscape('/home/user/projects/app/safe-link');
    expect(result.allowed).toBe(true);
  });

  // Junction points behave identically to symlinks in our resolution model
  it('rejects junction that resolves outside project scope', () => {
    const result = checkSymlinkEscape('/home/user/projects/app/link-to-etc');
    expect(result.allowed).toBe(false);
  });
});

describe('Governance — File Size Limits', () => {
  it('allows file under size limit', () => {
    const result = checkFileSize(1024);
    expect(result.allowed).toBe(true);
  });

  it('rejects file over size limit', () => {
    const result = checkFileSize(10 * 1024 * 1024);
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain('file_too_large');
  });

  it('allows file exactly at size limit', () => {
    const result = checkFileSize(MAX_FILE_SIZE_BYTES);
    expect(result.allowed).toBe(true);
  });
});

describe('Governance — Rate Limiting', () => {
  beforeEach(() => {
    rateLimitMap = new Map();
  });

  it('allows requests within rate limit', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      const result = checkRateLimit('sess-001');
      expect(result.allowed).toBe(true);
    }
  });

  it('rejects requests exceeding rate limit', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit('sess-001');
    }

    const result = checkRateLimit('sess-001');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
  });

  it('rate limits are per-session', () => {
    for (let i = 0; i < RATE_LIMIT_MAX; i++) {
      checkRateLimit('sess-001');
    }

    // Different session should still be allowed
    const result = checkRateLimit('sess-002');
    expect(result.allowed).toBe(true);
  });
});

describe('Governance — Write Authorization', () => {
  it('requires approval token for writes', () => {
    const result = validateWriteRequest({
      filePath: '/home/user/projects/myapp/src/index.ts',
      sessionId: 'sess-001',
      approvalTokenId: null,
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('approval_token_required');
  });

  it('allows write with valid approval token', () => {
    const result = validateWriteRequest({
      filePath: '/home/user/projects/myapp/src/index.ts',
      sessionId: 'sess-001',
      approvalTokenId: 'tok-001',
    });

    expect(result.allowed).toBe(true);
  });

  it('rejects write to protected path even with token', () => {
    const result = validateWriteRequest({
      filePath: '/home/user/projects/myapp/.env',
      sessionId: 'sess-001',
      approvalTokenId: 'tok-001',
    });

    expect(result.allowed).toBe(false);
    expect(result.reason).toBe('protected_path');
  });
});

describe('Governance — Allowlist Enforcement', () => {
  it('allows known file extensions', () => {
    expect(isAllowedExtension('index.ts')).toBe(true);
    expect(isAllowedExtension('styles.css')).toBe(true);
    expect(isAllowedExtension('config.yaml')).toBe(true);
    expect(isAllowedExtension('deploy.sh')).toBe(true);
  });

  it('rejects unknown file extensions', () => {
    expect(isAllowedExtension('binary.exe')).toBe(false);
    expect(isAllowedExtension('malware.dll')).toBe(false);
    expect(isAllowedExtension('archive.zip')).toBe(false);
    expect(isAllowedExtension('image.png')).toBe(false);
  });

  it('rejects files with no extension', () => {
    expect(isAllowedExtension('Makefile')).toBe(false);
  });
});
