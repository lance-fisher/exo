import { SafeShell, ShellResult } from '../shell/SafeShell';

export interface TestResult {
  name: string;
  passed: boolean;
  output: string;
  duration_ms: number;
}

export class TestRunner {
  private shell: SafeShell;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.shell = new SafeShell(workspaceRoot);
  }

  /**
   * Auto-detect test framework and run tests
   */
  runTests(testPath?: string): { results: TestResult[]; raw: ShellResult } {
    const command = this.detectTestCommand(testPath);
    const result = this.shell.execute(command, {
      cwd: this.workspaceRoot,
      timeout: 120000,
    });

    return {
      results: this.parseTestOutput(result),
      raw: result,
    };
  }

  private detectTestCommand(testPath?: string): string {
    const fs = require('fs');
    const path = require('path');

    // Check for package.json test script
    const pkgPath = path.join(this.workspaceRoot, 'package.json');
    if (fs.existsSync(pkgPath)) {
      const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
      if (pkg.scripts?.test) {
        return testPath ? `npm test -- ${testPath}` : 'npm test';
      }
    }

    // Check for pytest
    const pytestConfig = path.join(this.workspaceRoot, 'pytest.ini');
    const setupCfg = path.join(this.workspaceRoot, 'setup.cfg');
    if (fs.existsSync(pytestConfig) || fs.existsSync(setupCfg)) {
      return testPath ? `pytest ${testPath}` : 'pytest';
    }

    // Check for Makefile test target
    const makefile = path.join(this.workspaceRoot, 'Makefile');
    if (fs.existsSync(makefile)) {
      const makeContent = fs.readFileSync(makefile, 'utf-8');
      if (makeContent.includes('test:')) {
        return 'make test';
      }
    }

    return testPath ? `npm test -- ${testPath}` : 'npm test';
  }

  private parseTestOutput(result: ShellResult): TestResult[] {
    const output = result.stdout + result.stderr;
    const results: TestResult[] = [];

    // Simple heuristic parsing - works for most test frameworks
    const lines = output.split('\n');
    for (const line of lines) {
      // Jest/Mocha style: PASS/FAIL
      const jestMatch = line.match(/(PASS|FAIL)\s+(.+)/);
      if (jestMatch) {
        results.push({
          name: jestMatch[2].trim(),
          passed: jestMatch[1] === 'PASS',
          output: line,
          duration_ms: result.duration_ms,
        });
        continue;
      }

      // Pytest style: PASSED/FAILED
      const pytestMatch = line.match(/(.+?)\s+(PASSED|FAILED)/);
      if (pytestMatch) {
        results.push({
          name: pytestMatch[1].trim(),
          passed: pytestMatch[2] === 'PASSED',
          output: line,
          duration_ms: result.duration_ms,
        });
      }
    }

    // If no individual tests parsed, create a single aggregate result
    if (results.length === 0) {
      results.push({
        name: 'test suite',
        passed: result.exit_code === 0,
        output: output.substring(0, 2000),
        duration_ms: result.duration_ms,
      });
    }

    return results;
  }
}
