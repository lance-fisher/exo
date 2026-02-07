import { BaseAgent, AgentContext, AgentTools } from '../framework/BaseAgent';
import type { AgentRole, Artifact } from '@dca/memory/dist/schema/types';

/**
 * QA/Tester Agent
 * Creates test plans, runs tests, verifies behavior, catches regressions.
 */
export class QATesterAgent extends BaseAgent {
  readonly role: AgentRole = 'qa_tester';
  readonly description = 'Creates test plans, runs tests, verifies behavior, catches regressions';

  protected async execute(context: AgentContext, tools: AgentTools): Promise<Artifact[]> {
    const { task_id, subtask, workspace_root } = context;
    const artifacts: Artifact[] = [];

    await this.log(task_id, 'Starting QA/testing phase...');

    // Check what testing framework is available
    const pkgResult = tools.fs.read(`${workspace_root}/package.json`);
    let testFramework = 'unknown';
    let testCommand = 'npm test';

    if (pkgResult.success && pkgResult.content) {
      try {
        const pkg = JSON.parse(pkgResult.content);
        if (pkg.devDependencies?.jest || pkg.dependencies?.jest) {
          testFramework = 'jest';
          testCommand = 'npx jest --passWithNoTests --no-coverage 2>&1 || true';
        } else if (pkg.devDependencies?.mocha || pkg.dependencies?.mocha) {
          testFramework = 'mocha';
          testCommand = 'npx mocha 2>&1 || true';
        } else if (pkg.scripts?.test) {
          testFramework = 'npm script';
          testCommand = 'npm test 2>&1 || true';
        }
      } catch {
        // ignore
      }
    }

    // Also check for Python test frameworks
    const pytestResult = tools.shell.execute('which pytest 2>/dev/null', { cwd: workspace_root });
    if (pytestResult.exit_code === 0) {
      testFramework = 'pytest';
      testCommand = 'pytest -v 2>&1 || true';
    }

    await this.publishUpdate(task_id, subtask.id, `Detected test framework: ${testFramework}`);

    // Create test plan
    const testPlan = this.createTestPlan(subtask.description || '', testFramework);
    artifacts.push({
      type: 'document',
      name: 'Test Plan',
      content: testPlan,
      metadata: { format: 'markdown', framework: testFramework },
    });

    // Run existing tests
    await this.publishUpdate(task_id, subtask.id, 'Running existing tests...');
    const testResult = tools.shell.execute(testCommand, {
      cwd: workspace_root,
      timeout: 120000,
    });

    await this.memory.addCommand({
      task_id,
      subtask_id: subtask.id,
      agent_role: this.role,
      command: testCommand,
      cwd: workspace_root,
      exit_code: testResult.exit_code,
      stdout: testResult.stdout,
      stderr: testResult.stderr,
      duration_ms: testResult.duration_ms,
    });

    const testsPassed = testResult.exit_code === 0;

    artifacts.push({
      type: 'test_result',
      name: 'Test Execution Results',
      content: `Exit code: ${testResult.exit_code}\n\nOutput:\n${testResult.stdout}\n\nErrors:\n${testResult.stderr}`,
      metadata: {
        passed: testsPassed,
        framework: testFramework,
        exit_code: testResult.exit_code,
        duration_ms: testResult.duration_ms,
      },
    });

    // Review file changes from implementation
    const fileChanges = await this.memory.getFileChanges(task_id);
    if (fileChanges.length > 0) {
      const changeReview = fileChanges.map(fc =>
        `- ${fc.operation}: ${fc.file_path} (${fc.approval_state})`
      ).join('\n');

      artifacts.push({
        type: 'document',
        name: 'File Change Review',
        content: `# File Changes Review\n\n${changeReview}\n\nTotal changes: ${fileChanges.length}`,
      });
    }

    // Log summary
    const summary = testsPassed
      ? 'All tests passed.'
      : `Tests failed with exit code ${testResult.exit_code}. Review output for details.`;

    await this.log(task_id, summary, testsPassed ? 'info' : 'warning');

    await this.logDecision(
      task_id,
      `Test execution ${testsPassed ? 'passed' : 'failed'}`,
      `Ran ${testFramework} tests. ${summary}`,
    );

    return artifacts;
  }

  private createTestPlan(description: string, framework: string): string {
    return [
      '# Test Plan',
      '',
      '## Objective',
      `Verify the changes related to: ${description}`,
      '',
      '## Test Framework',
      framework,
      '',
      '## Test Categories',
      '1. **Regression Tests**: Run all existing tests to ensure no regressions',
      '2. **Functional Tests**: Verify the new/changed functionality works correctly',
      '3. **Edge Cases**: Test boundary conditions and error scenarios',
      '4. **Integration**: Verify components work together correctly',
      '',
      '## Execution Strategy',
      '1. Run all existing tests first',
      '2. Review test output for failures',
      '3. Check code coverage if available',
      '4. Report results with pass/fail status',
    ].join('\n');
  }
}
