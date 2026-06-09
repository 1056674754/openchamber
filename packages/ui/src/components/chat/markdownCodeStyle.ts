import type { CSSProperties } from 'react';

export const MARKDOWN_CODE_BODY_CLASSNAME = 'overflow-x-auto overflow-y-hidden px-2.5 py-2';

export const CODE_SHARED_STYLE: CSSProperties = {
  margin: 0,
  background: 'transparent',
  padding: 0,
  overflow: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
  fontFamily: 'var(--font-mono-cjk, var(--font-mono))',
  fontSize: 'var(--text-code)',
  lineHeight: 'var(--markdown-code-block-line-height)',
  letterSpacing: '0',
  fontVariantLigatures: 'none',
  fontFeatureSettings: '"liga" 0, "calt" 0',
  tabSize: 4,
};
