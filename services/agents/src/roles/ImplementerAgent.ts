import { BaseAgent, AgentContext, AgentTools } from '../framework/BaseAgent';
import type { AgentRole, Artifact } from '@dca/memory/dist/schema/types';

/**
 * Implementer Agent
 * Writes code, integrates services, creates UI, adds features.
 * This is the primary code-writing agent.
 */
export class ImplementerAgent extends BaseAgent {
  readonly role: AgentRole = 'implementer';
  readonly description = 'Writes code, integrates services, creates UI, adds features';

  protected async execute(context: AgentContext, tools: AgentTools): Promise<Artifact[]> {
    const { task_id, subtask, workspace_root } = context;
    const artifacts: Artifact[] = [];

    await this.log(task_id, 'Starting implementation...');
    await this.publishUpdate(task_id, subtask.id, 'Analyzing requirements and preparing implementation');

    // Check risk tier - if CAUTION or DANGEROUS, request approval first
    if (subtask.risk_tier === 'DANGEROUS') {
      await this.requestApproval(
        task_id,
        subtask.id,
        `Implementation involves DANGEROUS operations: ${subtask.description}`,
        'DANGEROUS',
      );
      // Agent will be resumed after approval
      return [{
        type: 'log',
        name: 'Awaiting Approval',
        content: 'Implementation paused pending approval for dangerous operations',
      }];
    }

    // Gather context about what needs to be done
    const description = subtask.description || '';

    // Read prior agent messages for context (requirements, architecture)
    const messages = await this.memory.getMessages(task_id);
    const priorArtifacts = messages
      .filter(m => m.role === 'product_manager' || m.role === 'architect')
      .map(m => m.content);

    // Analyze workspace
    const dirListing = tools.fs.listDirectory(workspace_root);
    await this.publishUpdate(task_id, subtask.id, 'Workspace analyzed, beginning implementation');

    // Record what the implementer would do
    const implementationPlan = this.createImplementationPlan(description, priorArtifacts, dirListing.content || '');

    artifacts.push({
      type: 'document',
      name: 'Implementation Plan',
      content: implementationPlan,
      metadata: { format: 'markdown' },
    });

    // Simulate implementation actions based on the request
    const actions = this.determineActions(description);

    for (const action of actions) {
      await this.publishUpdate(task_id, subtask.id, `Executing: ${action.description}`);

      if (action.type === 'shell') {
        const result = tools.shell.execute(action.command!, {
          cwd: workspace_root,
          approved: subtask.risk_tier === 'SAFE',
        });

        await this.memory.addCommand({
          task_id,
          subtask_id: subtask.id,
          agent_role: this.role,
          command: action.command!,
          cwd: workspace_root,
          exit_code: result.exit_code,
          stdout: result.stdout,
          stderr: result.stderr,
          duration_ms: result.duration_ms,
        });

        if (result.exit_code !== 0 && result.risk.tier !== 'SAFE') {
          artifacts.push({
            type: 'log',
            name: `Command failed: ${action.command}`,
            content: `Exit code: ${result.exit_code}\nStderr: ${result.stderr}`,
          });
        }
      } else if (action.type === 'file_write') {
        const writeResult = tools.fs.write(
          `${workspace_root}/${action.path!}`,
          action.content!,
          { approved: subtask.risk_tier === 'SAFE' || subtask.risk_tier === 'CAUTION' },
        );

        if (writeResult.success) {
          await this.memory.addFileChange({
            task_id,
            subtask_id: subtask.id,
            file_path: action.path!,
            operation: writeResult.operation as 'create' | 'modify',
            diff: writeResult.diff,
            reason: action.description,
            backup_path: writeResult.backup_path,
          });

          artifacts.push({
            type: 'diff',
            name: `File: ${action.path}`,
            content: writeResult.diff || `Created ${action.path}`,
          });
        }
      } else if (action.type === 'file_read') {
        const readResult = tools.fs.read(`${workspace_root}/${action.path!}`);
        if (readResult.success) {
          artifacts.push({
            type: 'log',
            name: `Read: ${action.path}`,
            content: (readResult.content || '').substring(0, 5000),
          });
        }
      }
    }

    await this.log(task_id, `Implementation complete. Performed ${actions.length} actions.`);
    return artifacts;
  }

  private createImplementationPlan(description: string, priorArtifacts: string[], dirListing: string): string {
    return [
      '# Implementation Plan',
      '',
      '## Objective',
      description,
      '',
      '## Context from Prior Analysis',
      priorArtifacts.length > 0
        ? priorArtifacts.map(a => `- ${a.substring(0, 200)}`).join('\n')
        : 'No prior analysis available',
      '',
      '## Workspace',
      '```',
      dirListing.substring(0, 1000),
      '```',
      '',
      '## Actions to Take',
      '- Analyze existing code',
      '- Implement requested changes',
      '- Generate diffs for all file changes',
      '- Report results and artifacts',
    ].join('\n');
  }

  private determineActions(description: string): Array<{
    type: 'shell' | 'file_write' | 'file_read';
    description: string;
    command?: string;
    path?: string;
    content?: string;
  }> {
    const actions: Array<{
      type: 'shell' | 'file_write' | 'file_read';
      description: string;
      command?: string;
      path?: string;
      content?: string;
    }> = [];

    // Always start by reading the current state
    actions.push({
      type: 'shell',
      description: 'Check project structure',
      command: 'ls -la',
    });

    // If description mentions tests, check for test files
    if (description.toLowerCase().includes('test')) {
      actions.push({
        type: 'shell',
        description: 'Look for existing tests',
        command: 'find . -name "*.test.*" -o -name "*.spec.*" | head -20',
      });
    }

    // If description mentions git
    if (description.toLowerCase().includes('git') || description.toLowerCase().includes('commit')) {
      actions.push({
        type: 'shell',
        description: 'Check git status',
        command: 'git status --porcelain',
      });
    }

    return actions;
  }
}
