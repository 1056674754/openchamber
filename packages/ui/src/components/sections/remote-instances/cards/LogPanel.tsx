import React, { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Icon } from '@/components/icon/Icon';
import type { LogPanelProps } from './types';

interface ParsedLogLine {
  level: 'error' | 'warning' | 'info' | 'debug' | 'other';
  display: string;
}

function parseLogLevel(line: string): ParsedLogLine {
  const upper = line.toUpperCase();
  if (/\bERR(OR)?\b/.test(upper)) return { level: 'error', display: line };
  if (/\bWARN(ING)?\b/.test(upper)) return { level: 'warning', display: line };
  if (/\bINFO\b/.test(upper)) return { level: 'info', display: line };
  if (/\bDEBUG\b/.test(upper)) return { level: 'debug', display: line };
  return { level: 'other', display: line };
}

function levelColor(level: ParsedLogLine['level']): string {
  switch (level) {
    case 'error':
      return 'text-[var(--status-error)]';
    case 'warning':
      return 'text-[var(--status-warning)]';
    case 'info':
      return 'text-[var(--status-info)]';
    default:
      return 'text-muted-foreground';
  }
}

export function LogPanel({
  open,
  loading,
  error,
  lines,
  onCopyAll,
  onClear,
}: LogPanelProps) {
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [lines]);

  if (!open) return null;

  return (
    <div className="flex flex-col min-h-0">
      {/* Toolbar */}
      <div className="flex items-center justify-between py-1">
        <span className="flex-1" />
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClear}
            disabled={lines.length === 0}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[7px] px-1.5 typography-micro text-muted-foreground transition-colors hover:bg-[var(--interactive-hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="delete-bin" className="h-3.5 w-3.5" />
            Clear
          </button>
          <button
            type="button"
            onClick={onCopyAll}
            disabled={lines.length === 0}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-[7px] px-1.5 typography-micro text-muted-foreground transition-colors hover:bg-[var(--interactive-hover)] hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
          >
            <Icon name="file-copy" className="h-3.5 w-3.5" />
            Copy All
          </button>
        </div>
      </div>

      {/* Log body */}
      <div
        ref={logRef}
        className="flex-1 min-h-[300px] max-h-[50vh] overflow-y-auto rounded-lg bg-[var(--surface-muted)] px-3 py-2 font-mono text-[0.8125rem] leading-relaxed"
        role="log"
        aria-live="polite"
      >
        {loading && (
          <div className="flex items-center gap-2 text-muted-foreground">
            <Icon name="loader-4" className="h-4 w-4 animate-spin" />
            <span>Loading logs...</span>
          </div>
        )}

        {error && (
          <div className="text-[var(--status-error)]">
            {error}
          </div>
        )}

        {!loading && !error && lines.length === 0 && (
          <span className="text-muted-foreground/60">No logs yet.</span>
        )}

        {!loading && lines.length > 0 && (
          <div className="space-y-0">
            {lines.map((line, i) => {
              const { level } = parseLogLevel(line);
              const textColor = levelColor(level);
              return (
                <div
                  key={i}
                  className={cn('whitespace-pre-wrap break-words', textColor)}
                >
                  {line}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
