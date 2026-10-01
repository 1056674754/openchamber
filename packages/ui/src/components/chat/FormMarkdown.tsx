import React from 'react';

import { cn } from '@/lib/utils';
import { SimpleMarkdownRenderer } from './MarkdownRenderer';

interface FormMarkdownProps {
  content: string;
  size: 'meta' | 'micro';
  className?: string;
}

/**
 * Inline Markdown for v2 form field descriptions. Upstream hangs the
 * typography classes on the renderer and swaps in a plain-text
 * `fallbackContent` while its chunk loads; the fork's lazy renderer recovers
 * chunks itself, so the classes live on a wrapper instead — the description
 * keeps its typography even before the renderer mounts.
 */
export function FormMarkdown({ content, size, className }: FormMarkdownProps) {
  const classes = cn('form-markdown', size === 'meta' ? 'typography-meta' : 'typography-micro', className);

  return (
    <div className={classes}>
      <SimpleMarkdownRenderer content={content} variant="tool" />
    </div>
  );
}
