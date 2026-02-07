import * as fs from 'fs';
import * as path from 'path';
import { RiskAssessor, RiskAssessment } from '../RiskAssessor';

export interface FileResult {
  operation: string;
  file_path: string;
  success: boolean;
  content?: string;
  diff?: string;
  error?: string;
  risk: RiskAssessment;
  backup_path?: string;
}

export class SafeFileSystem {
  private riskAssessor: RiskAssessor;
  private workspaceRoot: string;
  private backupDir: string;

  constructor(workspaceRoot: string) {
    this.workspaceRoot = path.resolve(workspaceRoot);
    this.riskAssessor = new RiskAssessor(this.workspaceRoot);
    this.backupDir = path.join(this.workspaceRoot, '.dca-backups');
  }

  private ensureBackupDir(): void {
    if (!fs.existsSync(this.backupDir)) {
      fs.mkdirSync(this.backupDir, { recursive: true });
    }
  }

  private validatePath(filePath: string): string {
    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(this.workspaceRoot)) {
      throw new Error(`Path "${filePath}" is outside workspace root`);
    }
    return resolved;
  }

  private createBackup(filePath: string): string | undefined {
    if (!fs.existsSync(filePath)) return undefined;
    this.ensureBackupDir();
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = path.basename(filePath);
    const backupPath = path.join(this.backupDir, `${timestamp}_${baseName}`);
    fs.copyFileSync(filePath, backupPath);
    return backupPath;
  }

  read(filePath: string): FileResult {
    const risk = this.riskAssessor.assessFileOperation('read', filePath);
    try {
      const resolved = this.validatePath(filePath);
      const content = fs.readFileSync(resolved, 'utf-8');
      return {
        operation: 'read',
        file_path: filePath,
        success: true,
        content,
        risk,
      };
    } catch (error: unknown) {
      return {
        operation: 'read',
        file_path: filePath,
        success: false,
        error: (error as Error).message,
        risk,
      };
    }
  }

  write(filePath: string, content: string, options?: {
    approved?: boolean;
    dryRun?: boolean;
  }): FileResult {
    const exists = fs.existsSync(filePath);
    const operation = exists ? 'modify' : 'create';
    const risk = this.riskAssessor.assessFileOperation(operation, filePath);

    if (risk.requires_approval && !options?.approved) {
      return {
        operation,
        file_path: filePath,
        success: false,
        error: `[BLOCKED] File ${operation} requires ${risk.tier} approval`,
        risk,
      };
    }

    try {
      const resolved = this.validatePath(filePath);

      if (options?.dryRun) {
        let diff: string | undefined;
        if (exists) {
          const existing = fs.readFileSync(resolved, 'utf-8');
          diff = this.generateSimpleDiff(existing, content, filePath);
        } else {
          diff = `+++ ${filePath} (new file)\n${content.split('\n').map(l => `+ ${l}`).join('\n')}`;
        }
        return {
          operation,
          file_path: filePath,
          success: true,
          diff,
          risk,
        };
      }

      let backupPath: string | undefined;
      if (risk.requires_backup && exists) {
        backupPath = this.createBackup(resolved);
      }

      // Ensure directory exists
      const dir = path.dirname(resolved);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      let diff: string | undefined;
      if (exists) {
        const existing = fs.readFileSync(resolved, 'utf-8');
        diff = this.generateSimpleDiff(existing, content, filePath);
      }

      fs.writeFileSync(resolved, content, 'utf-8');

      return {
        operation,
        file_path: filePath,
        success: true,
        diff,
        risk,
        backup_path: backupPath,
      };
    } catch (error: unknown) {
      return {
        operation,
        file_path: filePath,
        success: false,
        error: (error as Error).message,
        risk,
      };
    }
  }

  delete(filePath: string, options?: {
    approved?: boolean;
    dryRun?: boolean;
  }): FileResult {
    const risk = this.riskAssessor.assessFileOperation('delete', filePath);

    if (!options?.approved) {
      return {
        operation: 'delete',
        file_path: filePath,
        success: false,
        error: `[BLOCKED] File deletion requires DANGEROUS approval`,
        risk,
      };
    }

    try {
      const resolved = this.validatePath(filePath);

      if (options?.dryRun) {
        return {
          operation: 'delete',
          file_path: filePath,
          success: true,
          diff: `--- ${filePath} (deleted)`,
          risk,
        };
      }

      const backupPath = this.createBackup(resolved);
      fs.unlinkSync(resolved);

      return {
        operation: 'delete',
        file_path: filePath,
        success: true,
        risk,
        backup_path: backupPath,
      };
    } catch (error: unknown) {
      return {
        operation: 'delete',
        file_path: filePath,
        success: false,
        error: (error as Error).message,
        risk,
      };
    }
  }

  listDirectory(dirPath: string): FileResult {
    const risk = this.riskAssessor.assessFileOperation('read', dirPath);
    try {
      const resolved = this.validatePath(dirPath);
      const entries = fs.readdirSync(resolved, { withFileTypes: true });
      const listing = entries.map(e => ({
        name: e.name,
        type: e.isDirectory() ? 'directory' : 'file',
        size: e.isFile() ? fs.statSync(path.join(resolved, e.name)).size : undefined,
      }));
      return {
        operation: 'list',
        file_path: dirPath,
        success: true,
        content: JSON.stringify(listing, null, 2),
        risk,
      };
    } catch (error: unknown) {
      return {
        operation: 'list',
        file_path: dirPath,
        success: false,
        error: (error as Error).message,
        risk,
      };
    }
  }

  private generateSimpleDiff(oldContent: string, newContent: string, filePath: string): string {
    const oldLines = oldContent.split('\n');
    const newLines = newContent.split('\n');
    const lines: string[] = [`--- a/${filePath}`, `+++ b/${filePath}`];

    const maxLines = Math.max(oldLines.length, newLines.length);
    for (let i = 0; i < maxLines; i++) {
      if (i >= oldLines.length) {
        lines.push(`+ ${newLines[i]}`);
      } else if (i >= newLines.length) {
        lines.push(`- ${oldLines[i]}`);
      } else if (oldLines[i] !== newLines[i]) {
        lines.push(`- ${oldLines[i]}`);
        lines.push(`+ ${newLines[i]}`);
      }
    }
    return lines.join('\n');
  }
}
