import { BaseAgent, AgentContext, AgentTools } from '../framework/BaseAgent';
import type { AgentRole, Artifact } from '@dca/memory/dist/schema/types';

/**
 * Product Manager Agent
 * Translates user requests into requirements, success criteria, and constraints.
 */
export class ProductManagerAgent extends BaseAgent {
  readonly role: AgentRole = 'product_manager';
  readonly description = 'Translates user requests into clear requirements, success criteria, and constraints';

  protected async execute(context: AgentContext, tools: AgentTools): Promise<Artifact[]> {
    const { task_id, subtask, workspace_root } = context;
    const artifacts: Artifact[] = [];

    await this.log(task_id, 'Analyzing user request and generating requirements...');

    // Gather context about the workspace
    const dirResult = tools.fs.listDirectory(workspace_root);
    const workspaceInfo = dirResult.success ? dirResult.content : 'Unable to read workspace directory';

    // Check for existing documentation/README
    const readmeResult = tools.fs.read(`${workspace_root}/README.md`);
    const hasReadme = readmeResult.success;

    // Check for package.json or similar project files
    const pkgResult = tools.fs.read(`${workspace_root}/package.json`);
    const hasPkg = pkgResult.success;

    // Build requirements document
    const requirements = this.generateRequirements(
      subtask.description || '',
      workspaceInfo || '',
      hasReadme ? readmeResult.content || '' : '',
      hasPkg ? pkgResult.content || '' : '',
    );

    artifacts.push({
      type: 'document',
      name: 'Requirements Analysis',
      content: requirements,
      metadata: { format: 'markdown' },
    });

    await this.log(task_id, `Requirements analysis complete. Identified ${requirements.split('\n').filter(l => l.startsWith('- ')).length} requirements.`);

    // Log the decision about scope
    await this.logDecision(
      task_id,
      'Scope and requirements defined based on user request and project context',
      'Analyzed workspace structure and existing project configuration to determine appropriate scope',
    );

    return artifacts;
  }

  private generateRequirements(
    description: string,
    workspaceInfo: string,
    readme: string,
    packageJson: string,
  ): string {
    const lines: string[] = [
      '# Requirements Analysis',
      '',
      '## User Request',
      description,
      '',
      '## Interpreted Requirements',
    ];

    // Parse description for key action words
    const lower = description.toLowerCase();

    if (lower.includes('fix') || lower.includes('bug')) {
      lines.push('- Identify and fix the reported issue');
      lines.push('- Verify the fix does not introduce regressions');
      lines.push('- Add test coverage for the fixed scenario');
    }

    if (lower.includes('add') || lower.includes('create') || lower.includes('implement') || lower.includes('build')) {
      lines.push('- Implement the requested functionality');
      lines.push('- Follow existing code patterns and conventions');
      lines.push('- Add appropriate tests');
      lines.push('- Update documentation as needed');
    }

    if (lower.includes('refactor') || lower.includes('improve')) {
      lines.push('- Improve code quality without changing external behavior');
      lines.push('- Ensure all existing tests still pass');
      lines.push('- Document the rationale for changes');
    }

    if (lower.includes('test')) {
      lines.push('- Create comprehensive test coverage');
      lines.push('- Cover edge cases and error scenarios');
      lines.push('- Use the project\'s testing framework');
    }

    // Default requirements
    lines.push('- All changes must be within the workspace directory');
    lines.push('- Changes must not break existing functionality');

    lines.push('');
    lines.push('## Success Criteria');
    lines.push('- All requirements are met');
    lines.push('- Tests pass');
    lines.push('- No security vulnerabilities introduced');
    lines.push('- Code follows project conventions');

    lines.push('');
    lines.push('## Constraints');
    lines.push('- Stay within configured workspace root');
    lines.push('- Use existing project dependencies where possible');
    lines.push('- Follow project coding style');

    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        if (pkg.name) lines.push(`- Project: ${pkg.name}`);
        if (pkg.scripts) lines.push(`- Available scripts: ${Object.keys(pkg.scripts).join(', ')}`);
      } catch {
        // ignore parse errors
      }
    }

    lines.push('');
    lines.push('## Workspace Context');
    lines.push('```');
    lines.push(workspaceInfo.substring(0, 2000));
    lines.push('```');

    return lines.join('\n');
  }
}
