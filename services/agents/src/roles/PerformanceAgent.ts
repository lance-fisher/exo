import { BaseAgent, AgentContext, AgentTools } from '../framework/BaseAgent';
import type { AgentRole, Artifact } from '@dca/memory/dist/schema/types';

/**
 * Performance/Reliability Agent
 * Observability, retries, timeouts, metrics, failure recovery.
 */
export class PerformanceAgent extends BaseAgent {
  readonly role: AgentRole = 'performance';
  readonly description = 'Monitors performance, reliability, observability, and failure recovery';

  protected async execute(context: AgentContext, tools: AgentTools): Promise<Artifact[]> {
    const { task_id, subtask, workspace_root } = context;
    const artifacts: Artifact[] = [];

    await this.log(task_id, 'Running performance and reliability checks...');

    // Check disk space
    const diskResult = tools.shell.execute('df -h . 2>/dev/null || echo "disk check unavailable"', {
      cwd: workspace_root,
    });

    // Check for large files
    const largeFiles = tools.shell.execute(
      'find . -type f -size +10M 2>/dev/null | head -10 || echo "none found"',
      { cwd: workspace_root },
    );

    // Check node_modules size if applicable
    const nmSize = tools.shell.execute(
      'du -sh node_modules 2>/dev/null || echo "no node_modules"',
      { cwd: workspace_root },
    );

    // Check for performance anti-patterns in code
    const perfReport = [
      '# Performance and Reliability Report',
      '',
      '## System Resources',
      '### Disk Space',
      '```',
      diskResult.stdout || 'unavailable',
      '```',
      '',
      '### Large Files (>10MB)',
      largeFiles.stdout || 'None found',
      '',
      '### Dependencies Size',
      nmSize.stdout || 'N/A',
      '',
      '## Recommendations',
      '- Ensure adequate disk space for build artifacts',
      '- Monitor memory usage during test execution',
      '- Use incremental builds where possible',
      '- Consider .gitignore for generated files',
    ].join('\n');

    artifacts.push({
      type: 'document',
      name: 'Performance Report',
      content: perfReport,
      metadata: { format: 'markdown' },
    });

    // Review task execution metrics
    const commands = await this.memory.getCommands(task_id);
    const totalDuration = commands.reduce((sum, c) => sum + (c.duration_ms || 0), 0);
    const failedCommands = commands.filter(c => c.exit_code !== undefined && c.exit_code !== 0);

    const metricsReport = [
      '# Execution Metrics',
      '',
      `- Total commands: ${commands.length}`,
      `- Failed commands: ${failedCommands.length}`,
      `- Total execution time: ${totalDuration}ms`,
      `- Average command time: ${commands.length > 0 ? Math.round(totalDuration / commands.length) : 0}ms`,
    ].join('\n');

    artifacts.push({
      type: 'document',
      name: 'Execution Metrics',
      content: metricsReport,
    });

    await this.log(task_id, `Performance check complete. ${commands.length} commands tracked, total time: ${totalDuration}ms`);
    return artifacts;
  }
}
