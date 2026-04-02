'use client';

import { useRef, useEffect } from 'react';
import type { TaskStreamEvent } from '@/lib/hooks';
import Card from '@/components/ui/Card';
import Badge from '@/components/ui/Badge';
import { Copy, FileText, Coins, AlertCircle } from 'lucide-react';

interface TaskOutputProps {
  output: string;
  events: TaskStreamEvent[];
  streaming: boolean;
  error: string | null;
  tokensUsed: number;
}

export default function TaskOutput({
  output,
  events,
  streaming,
  error,
  tokensUsed,
}: TaskOutputProps) {
  const outputRef = useRef<HTMLDivElement>(null);

  // Auto-scroll during streaming
  useEffect(() => {
    if (streaming && outputRef.current) {
      outputRef.current.scrollTop = outputRef.current.scrollHeight;
    }
  }, [output, streaming]);

  const handleCopy = () => {
    navigator.clipboard.writeText(output);
  };

  const resultEvent = events.find((e) => e.type === 'result');
  const fileRefs = output.match(/(?:file|path):\s*([^\s\n]+)/gi) || [];

  return (
    <div className="space-y-4">
      {/* Output stream */}
      <Card
        header={
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-primary">
              Output
            </span>
            <div className="flex items-center gap-2">
              {tokensUsed > 0 && (
                <div className="flex items-center gap-1 text-xs text-text-muted">
                  <Coins className="h-3 w-3" />
                  {tokensUsed.toLocaleString()}
                </div>
              )}
              <button
                onClick={handleCopy}
                className="rounded p-1 text-text-muted transition-colors hover:bg-surface-overlay hover:text-text-primary"
                title="Copy output"
              >
                <Copy className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        }
      >
        <div
          ref={outputRef}
          className="max-h-[400px] overflow-auto rounded-lg border border-border bg-surface p-4 scrollbar-thin"
        >
          {output ? (
            <pre className="whitespace-pre-wrap font-mono text-sm leading-relaxed text-text-secondary">
              {output}
              {streaming && (
                <span className="inline-block h-4 w-1.5 animate-pulse bg-accent-blue" />
              )}
            </pre>
          ) : streaming ? (
            <div className="flex items-center gap-2 text-sm text-text-muted">
              <div className="h-3 w-3 animate-spin rounded-full border-2 border-accent-blue border-t-transparent" />
              Waiting for output...
            </div>
          ) : (
            <p className="text-sm text-text-muted">No output yet.</p>
          )}
        </div>
      </Card>

      {/* Error */}
      {error && (
        <div className="flex items-center gap-2 rounded-lg border border-accent-red/20 bg-accent-red/5 p-3">
          <AlertCircle className="h-4 w-4 flex-shrink-0 text-accent-red" />
          <span className="text-sm text-accent-red">{error}</span>
        </div>
      )}

      {/* File references */}
      {fileRefs.length > 0 && (
        <Card
          header={
            <span className="text-sm font-medium text-text-primary">
              Referenced Files
            </span>
          }
        >
          <div className="space-y-1.5">
            {fileRefs.map((ref, i) => {
              const path = ref.replace(/^(?:file|path):\s*/i, '');
              return (
                <div
                  key={i}
                  className="flex items-center gap-2 rounded-lg border border-border bg-surface px-3 py-2"
                >
                  <FileText className="h-3.5 w-3.5 text-text-muted" />
                  <span className="font-mono text-xs text-accent-blue">
                    {path}
                  </span>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      {/* Structured result */}
      {resultEvent && (
        <Card
          header={
            <div className="flex items-center gap-2">
              <span className="text-sm font-medium text-text-primary">
                Result
              </span>
              <Badge variant="success">Complete</Badge>
            </div>
          }
        >
          <pre className="whitespace-pre-wrap font-mono text-sm text-text-secondary">
            {JSON.stringify(resultEvent.data, null, 2)}
          </pre>
        </Card>
      )}
    </div>
  );
}
