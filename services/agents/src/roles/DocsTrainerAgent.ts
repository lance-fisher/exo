import { BaseAgent, AgentContext, AgentTools } from '../framework/BaseAgent';
import type { AgentRole, Artifact } from '@dca/memory/dist/schema/types';

/**
 * Docs/Trainer Agent
 * Writes user documentation and "non-coder" operating instructions.
 */
export class DocsTrainerAgent extends BaseAgent {
  readonly role: AgentRole = 'docs_trainer';
  readonly description = 'Writes user documentation and plain-English operating instructions';

  protected async execute(context: AgentContext, tools: AgentTools): Promise<Artifact[]> {
    const { task_id, subtask } = context;
    const artifacts: Artifact[] = [];

    await this.log(task_id, 'Generating documentation and user-friendly summary...');

    // Gather all context from the task
    const messages = await this.memory.getMessages(task_id);
    const fileChanges = await this.memory.getFileChanges(task_id);
    const commands = await this.memory.getCommands(task_id);
    const decisions = await this.memory.getDecisions(task_id);

    // Generate user-friendly summary
    const summary = this.generateUserSummary(subtask.description || '', messages, fileChanges, commands, decisions);
    artifacts.push({
      type: 'document',
      name: 'User Summary',
      content: summary,
      metadata: { format: 'markdown', audience: 'non-technical' },
    });

    // Generate speakable summary (for accessibility)
    const speakable = this.generateSpeakableSummary(messages, fileChanges, commands);
    artifacts.push({
      type: 'document',
      name: 'Speakable Summary',
      content: speakable,
      metadata: { format: 'text', audience: 'screen-reader' },
    });

    // Generate audit trail
    const auditTrail = this.generateAuditTrail(messages, fileChanges, commands, decisions);
    artifacts.push({
      type: 'document',
      name: 'Audit Trail',
      content: auditTrail,
      metadata: { format: 'markdown' },
    });

    await this.log(task_id, 'Documentation complete. Generated user summary, speakable summary, and audit trail.');
    return artifacts;
  }

  private generateUserSummary(
    description: string,
    messages: Array<{ role: string; content: string; created_at: Date }>,
    fileChanges: Array<{ file_path: string; operation: string; approval_state: string }>,
    commands: Array<{ command: string; exit_code?: number }>,
    decisions: Array<{ decision: string; reasoning?: string }>,
  ): string {
    const lines: string[] = [
      '# What Happened',
      '',
      '## Your Request',
      description,
      '',
      '## What We Did',
    ];

    // Summarize by agent role
    const roleMessages = new Map<string, string[]>();
    for (const msg of messages) {
      if (!roleMessages.has(msg.role)) {
        roleMessages.set(msg.role, []);
      }
      roleMessages.get(msg.role)!.push(msg.content);
    }

    const roleDescriptions: Record<string, string> = {
      product_manager: 'Requirements Analysis',
      architect: 'Architecture Design',
      implementer: 'Implementation',
      qa_tester: 'Testing',
      security: 'Security Review',
      docs_trainer: 'Documentation',
      performance: 'Performance Review',
    };

    for (const [role, msgs] of roleMessages) {
      const label = roleDescriptions[role] || role;
      lines.push(`\n### ${label}`);
      for (const msg of msgs.slice(-2)) {
        lines.push(`- ${msg}`);
      }
    }

    if (fileChanges.length > 0) {
      lines.push('');
      lines.push('## Files Changed');
      for (const fc of fileChanges) {
        lines.push(`- **${fc.operation}**: ${fc.file_path}`);
      }
    }

    if (commands.length > 0) {
      lines.push('');
      lines.push('## Commands Run');
      for (const cmd of commands.slice(-10)) {
        const status = cmd.exit_code === 0 ? 'OK' : `FAILED (code ${cmd.exit_code})`;
        lines.push(`- \`${cmd.command}\` -- ${status}`);
      }
    }

    if (decisions.length > 0) {
      lines.push('');
      lines.push('## Key Decisions');
      for (const d of decisions) {
        lines.push(`- ${d.decision}`);
        if (d.reasoning) lines.push(`  Reason: ${d.reasoning}`);
      }
    }

    return lines.join('\n');
  }

  private generateSpeakableSummary(
    messages: Array<{ role: string; content: string }>,
    fileChanges: Array<{ file_path: string; operation: string }>,
    commands: Array<{ command: string; exit_code?: number }>,
  ): string {
    const points: string[] = [];

    const totalSteps = messages.length;
    points.push(`The task was processed in ${totalSteps} steps.`);

    if (fileChanges.length > 0) {
      points.push(`${fileChanges.length} file${fileChanges.length > 1 ? 's were' : ' was'} changed.`);
    }

    const failedCommands = commands.filter(c => c.exit_code !== undefined && c.exit_code !== 0);
    if (commands.length > 0) {
      points.push(`${commands.length} command${commands.length > 1 ? 's were' : ' was'} executed.`);
      if (failedCommands.length > 0) {
        points.push(`${failedCommands.length} command${failedCommands.length > 1 ? 's' : ''} had errors.`);
      } else {
        points.push('All commands completed successfully.');
      }
    }

    return points.join(' ');
  }

  private generateAuditTrail(
    messages: Array<{ role: string; content: string; created_at: Date }>,
    fileChanges: Array<{ file_path: string; operation: string; created_at: Date }>,
    commands: Array<{ command: string; exit_code?: number; created_at: Date }>,
    decisions: Array<{ decision: string; agent_role: string; created_at: Date }>,
  ): string {
    const events: Array<{ time: Date; type: string; detail: string }> = [];

    for (const m of messages) {
      events.push({ time: m.created_at, type: `[${m.role}]`, detail: m.content });
    }
    for (const fc of fileChanges) {
      events.push({ time: fc.created_at, type: '[file]', detail: `${fc.operation}: ${fc.file_path}` });
    }
    for (const c of commands) {
      const status = c.exit_code === 0 ? 'OK' : `FAIL(${c.exit_code})`;
      events.push({ time: c.created_at, type: '[cmd]', detail: `${c.command} -- ${status}` });
    }
    for (const d of decisions) {
      events.push({ time: d.created_at, type: `[decision:${d.agent_role}]`, detail: d.decision });
    }

    events.sort((a, b) => a.time.getTime() - b.time.getTime());

    const lines = ['# Audit Trail', '', '| Time | Type | Detail |', '|------|------|--------|'];
    for (const e of events) {
      const timeStr = e.time.toISOString().substring(11, 19);
      lines.push(`| ${timeStr} | ${e.type} | ${e.detail.substring(0, 100)} |`);
    }

    return lines.join('\n');
  }
}
