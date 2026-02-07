import { BaseAgent, AgentContext, AgentTools } from '../framework/BaseAgent';
import type { AgentRole, Artifact } from '@dca/memory/dist/schema/types';

/**
 * Architect Agent
 * Designs system structure, interfaces, data models, and security boundaries.
 */
export class ArchitectAgent extends BaseAgent {
  readonly role: AgentRole = 'architect';
  readonly description = 'Designs system structure, interfaces, data models, and security boundaries';

  protected async execute(context: AgentContext, tools: AgentTools): Promise<Artifact[]> {
    const { task_id, subtask, workspace_root } = context;
    const artifacts: Artifact[] = [];

    await this.log(task_id, 'Analyzing project structure and designing solution architecture...');

    // Analyze project structure
    const dirResult = tools.fs.listDirectory(workspace_root);
    const srcDirResult = tools.fs.listDirectory(`${workspace_root}/src`);

    // Look for existing architecture patterns
    const pkgResult = tools.fs.read(`${workspace_root}/package.json`);
    const tsconfigResult = tools.fs.read(`${workspace_root}/tsconfig.json`);

    // Build architecture document
    const design = this.generateDesign(
      subtask.description || '',
      dirResult.success ? dirResult.content || '' : '',
      srcDirResult.success ? srcDirResult.content || '' : '',
      pkgResult.success ? pkgResult.content || '' : '',
      tsconfigResult.success ? tsconfigResult.content || '' : '',
    );

    artifacts.push({
      type: 'document',
      name: 'Architecture Design',
      content: design,
      metadata: { format: 'markdown' },
    });

    await this.logDecision(
      task_id,
      'Architecture design follows existing project patterns and conventions',
      'Analyzed existing directory structure, dependencies, and configuration to maintain consistency',
      [
        {
          option: 'Follow existing patterns',
          pros: ['Consistent', 'Lower learning curve', 'Less risk'],
          cons: ['May inherit existing technical debt'],
        },
        {
          option: 'Introduce new patterns',
          pros: ['Could improve architecture'],
          cons: ['Inconsistency', 'Higher risk', 'More changes needed'],
        },
      ],
    );

    await this.log(task_id, 'Architecture design complete.');
    return artifacts;
  }

  private generateDesign(
    description: string,
    rootDir: string,
    srcDir: string,
    packageJson: string,
    tsconfig: string,
  ): string {
    const lines: string[] = [
      '# Architecture Design',
      '',
      '## Objective',
      description,
      '',
      '## Existing Structure',
      '```',
      rootDir.substring(0, 2000),
      '```',
      '',
    ];

    if (srcDir) {
      lines.push('## Source Directory', '```', srcDir.substring(0, 2000), '```', '');
    }

    lines.push('## Design Decisions');
    lines.push('- Follow existing project conventions and directory structure');
    lines.push('- Minimize changes to existing files');
    lines.push('- Maintain separation of concerns');
    lines.push('- Ensure changes are backward compatible');

    lines.push('');
    lines.push('## Security Boundaries');
    lines.push('- All file operations restricted to workspace root');
    lines.push('- No external network calls unless explicitly required');
    lines.push('- Input validation at all entry points');
    lines.push('- No sensitive data in logs or artifacts');

    lines.push('');
    lines.push('## Interfaces');
    lines.push('- Follow existing API conventions if present');
    lines.push('- Use TypeScript types for type safety');
    lines.push('- Document public interfaces');

    if (packageJson) {
      try {
        const pkg = JSON.parse(packageJson);
        lines.push('');
        lines.push('## Dependencies');
        if (pkg.dependencies) {
          lines.push('Current dependencies:');
          Object.keys(pkg.dependencies).forEach(dep => {
            lines.push(`- ${dep}: ${pkg.dependencies[dep]}`);
          });
        }
      } catch {
        // ignore
      }
    }

    return lines.join('\n');
  }
}
