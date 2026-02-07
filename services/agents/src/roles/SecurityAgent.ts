import { BaseAgent, AgentContext, AgentTools } from '../framework/BaseAgent';
import type { AgentRole, Artifact } from '@dca/memory/dist/schema/types';
import { RiskAssessor } from '@dca/tools/dist/RiskAssessor';

/**
 * Security/Safety Agent
 * Enforces guardrails, reviews risky actions, validates sandboxing.
 */
export class SecurityAgent extends BaseAgent {
  readonly role: AgentRole = 'security';
  readonly description = 'Enforces guardrails, reviews risky actions, validates sandboxing';

  protected async execute(context: AgentContext, tools: AgentTools): Promise<Artifact[]> {
    const { task_id, subtask, workspace_root } = context;
    const artifacts: Artifact[] = [];

    await this.log(task_id, 'Performing security and safety review...');

    const riskAssessor = new RiskAssessor(workspace_root);

    // Review the request for security implications
    const securityReview = this.reviewRequest(subtask.description || '', riskAssessor);
    artifacts.push({
      type: 'document',
      name: 'Security Review',
      content: securityReview.report,
      metadata: {
        risk_level: securityReview.overallRisk,
        issues_found: securityReview.issues.length,
      },
    });

    // Check workspace for sensitive files
    await this.publishUpdate(task_id, subtask.id, 'Scanning workspace for sensitive files...');
    const sensitiveFiles = this.scanForSensitiveFiles(tools, workspace_root);
    if (sensitiveFiles.length > 0) {
      artifacts.push({
        type: 'document',
        name: 'Sensitive Files Warning',
        content: `# Sensitive Files Detected\n\nThe following files may contain sensitive data and should not be modified or committed:\n\n${sensitiveFiles.map(f => `- ${f}`).join('\n')}`,
        metadata: { count: sensitiveFiles.length },
      });

      await this.log(task_id, `Warning: Found ${sensitiveFiles.length} potentially sensitive files`, 'warning');
    }

    // Flag any risks
    if (securityReview.overallRisk === 'DANGEROUS') {
      await this.eventBus.publish('risk:flagged', {
        id: require('uuid').v4(),
        task_id,
        subtask_id: subtask.id,
        event_type: 'risk:flagged',
        agent_role: this.role,
        payload: {
          risk_level: 'DANGEROUS',
          issues: securityReview.issues,
          recommendation: 'Manual review required before proceeding',
        },
        timestamp: new Date().toISOString(),
      });
    }

    await this.logDecision(
      task_id,
      `Security review complete: ${securityReview.overallRisk} risk level`,
      `Found ${securityReview.issues.length} potential issues. ${securityReview.overallRisk === 'SAFE' ? 'No blocking concerns.' : 'Review recommended.'}`,
    );

    await this.log(task_id, `Security review complete. Risk level: ${securityReview.overallRisk}`);
    return artifacts;
  }

  private reviewRequest(description: string, riskAssessor: RiskAssessor): {
    report: string;
    overallRisk: string;
    issues: string[];
  } {
    const issues: string[] = [];
    const lower = description.toLowerCase();

    // Check for dangerous patterns in the request
    const dangerousPatterns = [
      { pattern: 'delete', issue: 'Request involves file deletion' },
      { pattern: 'remove', issue: 'Request involves removal operations' },
      { pattern: 'credential', issue: 'Request involves credentials' },
      { pattern: 'password', issue: 'Request involves passwords' },
      { pattern: 'secret', issue: 'Request involves secrets' },
      { pattern: 'token', issue: 'Request involves tokens' },
      { pattern: 'sudo', issue: 'Request involves elevated privileges' },
      { pattern: 'root', issue: 'Request may involve root access' },
      { pattern: 'install', issue: 'Request involves package installation' },
      { pattern: 'network', issue: 'Request involves network operations' },
      { pattern: 'external', issue: 'Request may involve external services' },
    ];

    for (const { pattern, issue } of dangerousPatterns) {
      if (lower.includes(pattern)) {
        issues.push(issue);
      }
    }

    let overallRisk = 'SAFE';
    if (issues.some(i => i.includes('credential') || i.includes('password') || i.includes('secret') || i.includes('sudo'))) {
      overallRisk = 'DANGEROUS';
    } else if (issues.some(i => i.includes('deletion') || i.includes('install') || i.includes('network'))) {
      overallRisk = 'CAUTION';
    }

    const report = [
      '# Security Review Report',
      '',
      '## Request Analysis',
      description,
      '',
      '## Risk Assessment',
      `Overall Risk Level: **${overallRisk}**`,
      '',
      '## Issues Found',
      issues.length > 0
        ? issues.map(i => `- ${i}`).join('\n')
        : 'No security concerns identified.',
      '',
      '## Guardrails',
      '- All operations sandboxed to workspace directory',
      '- Shell commands filtered through allowlist',
      '- Secrets redacted from logs and outputs',
      '- File operations backed up before modification',
      '- Dangerous operations require explicit approval',
      '',
      '## Recommendations',
      overallRisk === 'SAFE'
        ? 'Proceed with standard precautions.'
        : overallRisk === 'CAUTION'
          ? 'Proceed with approval workflow. Review operations before execution.'
          : 'Manual review required. Do not proceed without explicit user confirmation.',
    ].join('\n');

    return { report, overallRisk, issues };
  }

  private scanForSensitiveFiles(tools: AgentTools, workspaceRoot: string): string[] {
    const sensitivePatterns = [
      '.env', '.env.local', '.env.production',
      'credentials.json', 'secrets.json', 'key.pem', 'cert.pem',
      '.ssh', '.aws', '.npmrc', '.pypirc',
      'id_rsa', 'id_ed25519',
    ];

    const found: string[] = [];
    const dirResult = tools.fs.listDirectory(workspaceRoot);
    if (!dirResult.success || !dirResult.content) return found;

    try {
      const entries = JSON.parse(dirResult.content);
      for (const entry of entries) {
        if (sensitivePatterns.some(p => entry.name.includes(p))) {
          found.push(entry.name);
        }
      }
    } catch {
      // ignore parse errors
    }

    return found;
  }
}
