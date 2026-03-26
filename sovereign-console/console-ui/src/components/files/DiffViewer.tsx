'use client';

import { useState } from 'react';
import { clsx } from 'clsx';
import { Lock } from 'lucide-react';

interface DiffViewerProps {
  diff: string;
  className?: string;
}

interface DiffLine {
  type: 'add' | 'remove' | 'context' | 'header';
  content: string;
  lineNumber?: number;
  redacted?: boolean;
}

function parseDiff(diff: string): DiffLine[] {
  const lines: DiffLine[] = [];
  let lineNum = 0;

  for (const raw of diff.split('\n')) {
    const redacted = raw.includes('[REDACTED]');

    if (raw.startsWith('@@')) {
      const match = raw.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
      if (match) lineNum = parseInt(match[1], 10) - 1;
      lines.push({ type: 'header', content: raw, redacted });
    } else if (raw.startsWith('+')) {
      lineNum++;
      lines.push({ type: 'add', content: raw.slice(1), lineNumber: lineNum, redacted });
    } else if (raw.startsWith('-')) {
      lines.push({ type: 'remove', content: raw.slice(1), redacted });
    } else {
      lineNum++;
      lines.push({ type: 'context', content: raw.startsWith(' ') ? raw.slice(1) : raw, lineNumber: lineNum, redacted });
    }
  }

  return lines;
}

export default function DiffViewer({ diff, className }: DiffViewerProps) {
  const [mode, setMode] = useState<'unified' | 'split'>('unified');
  const lines = parseDiff(diff);

  return (
    <div className={clsx('rounded-lg border border-border', className)}>
      {/* Toolbar */}
      <div className="flex items-center justify-between border-b border-border px-3 py-2">
        <span className="text-xs text-text-muted">Diff Preview</span>
        <div className="flex gap-1">
          <button
            onClick={() => setMode('unified')}
            className={clsx(
              'rounded px-2 py-0.5 text-xs',
              mode === 'unified'
                ? 'bg-surface-overlay text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            Unified
          </button>
          <button
            onClick={() => setMode('split')}
            className={clsx(
              'rounded px-2 py-0.5 text-xs',
              mode === 'split'
                ? 'bg-surface-overlay text-text-primary'
                : 'text-text-muted hover:text-text-secondary'
            )}
          >
            Split
          </button>
        </div>
      </div>

      {/* Diff content */}
      <div className="max-h-[400px] overflow-auto scrollbar-thin">
        {mode === 'unified' ? (
          <table className="w-full font-mono text-xs">
            <tbody>
              {lines.map((line, i) => (
                <tr
                  key={i}
                  className={clsx(
                    line.type === 'add' && 'bg-accent-green/5',
                    line.type === 'remove' && 'bg-accent-red/5',
                    line.type === 'header' && 'bg-accent-blue/5'
                  )}
                >
                  <td className="w-10 select-none px-2 py-0.5 text-right text-text-muted">
                    {line.lineNumber || ''}
                  </td>
                  <td className="w-4 select-none text-center">
                    {line.type === 'add' && (
                      <span className="text-accent-green">+</span>
                    )}
                    {line.type === 'remove' && (
                      <span className="text-accent-red">-</span>
                    )}
                  </td>
                  <td className="whitespace-pre-wrap px-2 py-0.5">
                    {line.redacted ? (
                      <span className="inline-flex items-center gap-1">
                        <span
                          className={clsx(
                            line.type === 'add' && 'text-accent-green',
                            line.type === 'remove' && 'text-accent-red',
                            line.type === 'context' && 'text-text-secondary',
                            line.type === 'header' && 'text-accent-blue'
                          )}
                        >
                          {line.content.replace(/\[REDACTED\]/g, '')}
                        </span>
                        <span className="inline-flex items-center gap-0.5 rounded bg-accent-amber/20 px-1 py-0.5 text-[10px] text-accent-amber">
                          <Lock className="h-2.5 w-2.5" />
                          REDACTED
                        </span>
                      </span>
                    ) : (
                      <span
                        className={clsx(
                          line.type === 'add' && 'text-accent-green',
                          line.type === 'remove' && 'text-accent-red',
                          line.type === 'context' && 'text-text-secondary',
                          line.type === 'header' && 'text-accent-blue'
                        )}
                      >
                        {line.content}
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          /* Split view */
          <div className="grid grid-cols-2 divide-x divide-border">
            <div>
              <table className="w-full font-mono text-xs">
                <tbody>
                  {lines
                    .filter((l) => l.type !== 'add')
                    .map((line, i) => (
                      <tr
                        key={i}
                        className={clsx(
                          line.type === 'remove' && 'bg-accent-red/5',
                          line.type === 'header' && 'bg-accent-blue/5'
                        )}
                      >
                        <td className="w-10 select-none px-2 py-0.5 text-right text-text-muted">
                          {line.lineNumber || ''}
                        </td>
                        <td className="whitespace-pre-wrap px-2 py-0.5">
                          <span
                            className={clsx(
                              line.type === 'remove' && 'text-accent-red',
                              line.type === 'context' && 'text-text-secondary',
                              line.type === 'header' && 'text-accent-blue'
                            )}
                          >
                            {line.content}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
            <div>
              <table className="w-full font-mono text-xs">
                <tbody>
                  {lines
                    .filter((l) => l.type !== 'remove')
                    .map((line, i) => (
                      <tr
                        key={i}
                        className={clsx(
                          line.type === 'add' && 'bg-accent-green/5',
                          line.type === 'header' && 'bg-accent-blue/5'
                        )}
                      >
                        <td className="w-10 select-none px-2 py-0.5 text-right text-text-muted">
                          {line.lineNumber || ''}
                        </td>
                        <td className="whitespace-pre-wrap px-2 py-0.5">
                          <span
                            className={clsx(
                              line.type === 'add' && 'text-accent-green',
                              line.type === 'context' && 'text-text-secondary',
                              line.type === 'header' && 'text-accent-blue'
                            )}
                          >
                            {line.content}
                          </span>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
