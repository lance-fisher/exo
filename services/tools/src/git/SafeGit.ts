import { SafeShell, ShellResult } from '../shell/SafeShell';

export class SafeGit {
  private shell: SafeShell;
  private workspaceRoot: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = workspaceRoot;
    this.shell = new SafeShell(workspaceRoot);
  }

  status(): ShellResult {
    return this.shell.execute('git status --porcelain', { cwd: this.workspaceRoot });
  }

  diff(staged = false): ShellResult {
    const cmd = staged ? 'git diff --cached' : 'git diff';
    return this.shell.execute(cmd, { cwd: this.workspaceRoot });
  }

  log(count = 10): ShellResult {
    return this.shell.execute(`git log --oneline -${count}`, { cwd: this.workspaceRoot });
  }

  branch(): ShellResult {
    return this.shell.execute('git branch -a', { cwd: this.workspaceRoot });
  }

  add(files: string[]): ShellResult {
    const fileList = files.map(f => `"${f}"`).join(' ');
    return this.shell.execute(`git add ${fileList}`, {
      cwd: this.workspaceRoot,
      approved: true,
    });
  }

  commit(message: string): ShellResult {
    return this.shell.execute(`git commit -m "${message.replace(/"/g, '\\"')}"`, {
      cwd: this.workspaceRoot,
      approved: true,
    });
  }

  /**
   * Stash current changes for safety before risky operations
   */
  stash(): ShellResult {
    return this.shell.execute('git stash', { cwd: this.workspaceRoot, approved: true });
  }

  stashPop(): ShellResult {
    return this.shell.execute('git stash pop', { cwd: this.workspaceRoot, approved: true });
  }
}
