export type RiskTier = 'SAFE' | 'CAUTION' | 'DANGEROUS';

export interface RiskAssessment {
  tier: RiskTier;
  reason: string;
  requires_approval: boolean;
  requires_backup: boolean;
  dry_run_available: boolean;
}

const DANGEROUS_COMMANDS = [
  'rm -rf', 'rm -r', 'rmdir', 'mkfs', 'dd ', 'format',
  'chmod 777', 'chown', 'sudo', 'su ',
  'DROP TABLE', 'DROP DATABASE', 'TRUNCATE',
  '> /dev/', 'shutdown', 'reboot', 'init 0',
  'curl | sh', 'curl | bash', 'wget | sh',
];

const CAUTION_COMMANDS = [
  'npm install', 'yarn add', 'pip install', 'apt install',
  'mv ', 'rename', 'cp -r',
  'git push', 'git merge', 'git rebase', 'git reset',
  'docker rm', 'docker rmi',
  'sed -i', 'awk',
];

const SAFE_COMMANDS = [
  'ls', 'cat', 'head', 'tail', 'grep', 'find', 'wc',
  'echo', 'pwd', 'whoami', 'date', 'env',
  'git status', 'git diff', 'git log', 'git branch',
  'npm test', 'npm run test', 'jest', 'pytest',
  'node ', 'python ', 'tsc', 'eslint',
  'docker ps', 'docker logs',
];

const SECRET_PATTERNS = [
  /password\s*[:=]\s*\S+/gi,
  /secret\s*[:=]\s*\S+/gi,
  /api[_-]?key\s*[:=]\s*\S+/gi,
  /token\s*[:=]\s*\S+/gi,
  /Bearer\s+\S+/gi,
  /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/g,
  /aws_access_key_id\s*[:=]\s*\S+/gi,
  /aws_secret_access_key\s*[:=]\s*\S+/gi,
];

export class RiskAssessor {
  private workspaceRoot: string;
  private commandAllowlist: string[];

  constructor(workspaceRoot: string, additionalAllowedCommands: string[] = []) {
    this.workspaceRoot = workspaceRoot;
    this.commandAllowlist = [...SAFE_COMMANDS, ...additionalAllowedCommands];
  }

  assessCommand(command: string): RiskAssessment {
    const normalized = command.trim().toLowerCase();

    // Check dangerous first
    for (const pattern of DANGEROUS_COMMANDS) {
      if (normalized.includes(pattern.toLowerCase())) {
        return {
          tier: 'DANGEROUS',
          reason: `Command contains dangerous operation: "${pattern}"`,
          requires_approval: true,
          requires_backup: true,
          dry_run_available: false,
        };
      }
    }

    // Check caution
    for (const pattern of CAUTION_COMMANDS) {
      if (normalized.includes(pattern.toLowerCase())) {
        return {
          tier: 'CAUTION',
          reason: `Command involves potentially impactful operation: "${pattern}"`,
          requires_approval: true,
          requires_backup: false,
          dry_run_available: true,
        };
      }
    }

    // Check if on allowlist
    for (const allowed of this.commandAllowlist) {
      if (normalized.startsWith(allowed.toLowerCase())) {
        return {
          tier: 'SAFE',
          reason: 'Command is on the safe allowlist',
          requires_approval: false,
          requires_backup: false,
          dry_run_available: false,
        };
      }
    }

    // Unknown commands are CAUTION by default
    return {
      tier: 'CAUTION',
      reason: 'Command is not on the allowlist; treating as CAUTION by default',
      requires_approval: true,
      requires_backup: false,
      dry_run_available: true,
    };
  }

  assessFileOperation(operation: string, filePath: string): RiskAssessment {
    // Prevent path traversal
    if (filePath.includes('..') || !filePath.startsWith(this.workspaceRoot)) {
      return {
        tier: 'DANGEROUS',
        reason: `File path "${filePath}" is outside workspace root or uses path traversal`,
        requires_approval: true,
        requires_backup: true,
        dry_run_available: false,
      };
    }

    switch (operation) {
      case 'read':
        return {
          tier: 'SAFE',
          reason: 'Read-only operation',
          requires_approval: false,
          requires_backup: false,
          dry_run_available: false,
        };
      case 'create':
      case 'write':
        return {
          tier: 'SAFE',
          reason: 'File creation/write within workspace',
          requires_approval: false,
          requires_backup: false,
          dry_run_available: true,
        };
      case 'modify':
        return {
          tier: 'SAFE',
          reason: 'File modification within workspace',
          requires_approval: false,
          requires_backup: true,
          dry_run_available: true,
        };
      case 'rename':
      case 'move':
        return {
          tier: 'CAUTION',
          reason: 'File rename/move operation',
          requires_approval: true,
          requires_backup: true,
          dry_run_available: true,
        };
      case 'delete':
        return {
          tier: 'DANGEROUS',
          reason: 'File deletion',
          requires_approval: true,
          requires_backup: true,
          dry_run_available: true,
        };
      default:
        return {
          tier: 'CAUTION',
          reason: `Unknown file operation: ${operation}`,
          requires_approval: true,
          requires_backup: true,
          dry_run_available: true,
        };
    }
  }

  redactSecrets(text: string): string {
    let redacted = text;
    for (const pattern of SECRET_PATTERNS) {
      redacted = redacted.replace(pattern, '[REDACTED]');
    }
    return redacted;
  }

  isPathWithinWorkspace(filePath: string): boolean {
    const path = require('path');
    const resolved = path.resolve(filePath);
    const resolvedWorkspace = path.resolve(this.workspaceRoot);
    return resolved.startsWith(resolvedWorkspace);
  }
}
