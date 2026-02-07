import { execSync, ExecSyncOptions } from 'child_process';
import { RiskAssessor, RiskAssessment } from '../RiskAssessor';

export interface ShellResult {
  command: string;
  cwd: string;
  exit_code: number;
  stdout: string;
  stderr: string;
  duration_ms: number;
  risk: RiskAssessment;
}

export class SafeShell {
  private riskAssessor: RiskAssessor;
  private workspaceRoot: string;
  private maxOutputLength: number;

  constructor(workspaceRoot: string, maxOutputLength = 50000) {
    this.workspaceRoot = workspaceRoot;
    this.riskAssessor = new RiskAssessor(workspaceRoot);
    this.maxOutputLength = maxOutputLength;
  }

  /**
   * Execute a command within the workspace sandbox.
   * Returns result without executing if risk tier requires approval and approved=false.
   */
  execute(command: string, options?: {
    cwd?: string;
    timeout?: number;
    approved?: boolean;
    dryRun?: boolean;
  }): ShellResult {
    const risk = this.riskAssessor.assessCommand(command);
    const cwd = options?.cwd || this.workspaceRoot;
    const timeout = options?.timeout || 30000;
    const startTime = Date.now();

    // If risk requires approval but not given, return without executing
    if (risk.requires_approval && !options?.approved) {
      return {
        command,
        cwd,
        exit_code: -1,
        stdout: '',
        stderr: `[BLOCKED] Command requires ${risk.tier} approval: ${risk.reason}`,
        duration_ms: 0,
        risk,
      };
    }

    // Dry run mode - just return the assessment
    if (options?.dryRun) {
      return {
        command,
        cwd,
        exit_code: -1,
        stdout: `[DRY RUN] Would execute: ${command}`,
        stderr: '',
        duration_ms: 0,
        risk,
      };
    }

    // Verify cwd is within workspace
    if (!this.riskAssessor.isPathWithinWorkspace(cwd)) {
      return {
        command,
        cwd,
        exit_code: -1,
        stdout: '',
        stderr: `[BLOCKED] Working directory is outside workspace: ${cwd}`,
        duration_ms: 0,
        risk: { ...risk, tier: 'DANGEROUS' },
      };
    }

    try {
      const execOpts: ExecSyncOptions = {
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        encoding: 'utf-8',
        stdio: ['pipe', 'pipe', 'pipe'],
      };

      const stdout = execSync(command, execOpts) as string;
      const duration = Date.now() - startTime;

      return {
        command,
        cwd,
        exit_code: 0,
        stdout: this.truncateAndRedact(stdout || ''),
        stderr: '',
        duration_ms: duration,
        risk,
      };
    } catch (error: unknown) {
      const duration = Date.now() - startTime;
      const err = error as { status?: number; stdout?: string; stderr?: string };
      return {
        command,
        cwd,
        exit_code: err.status || 1,
        stdout: this.truncateAndRedact(err.stdout?.toString() || ''),
        stderr: this.truncateAndRedact(err.stderr?.toString() || ''),
        duration_ms: duration,
        risk,
      };
    }
  }

  private truncateAndRedact(text: string): string {
    const redacted = this.riskAssessor.redactSecrets(text);
    if (redacted.length > this.maxOutputLength) {
      return redacted.substring(0, this.maxOutputLength) + '\n[OUTPUT TRUNCATED]';
    }
    return redacted;
  }
}
