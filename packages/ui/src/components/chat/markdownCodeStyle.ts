import type { CSSProperties } from 'react';
import { CJK_MONO_FONT_FAMILIES } from '@/lib/fontOptions';

export const MARKDOWN_CODE_BODY_CLASSNAME = 'overflow-x-auto overflow-y-hidden px-2.5 py-2';

export const CODE_BLOCK_FONT_FAMILY = `${CJK_MONO_FONT_FAMILIES}, var(--font-mono)`;

export const CODE_SHARED_STYLE: CSSProperties = {
  margin: 0,
  background: 'transparent',
  padding: 0,
  overflow: 'visible',
  overflowX: 'visible',
  overflowY: 'visible',
  fontFamily: CODE_BLOCK_FONT_FAMILY,
  fontSize: 'var(--text-code)',
  lineHeight: 'var(--markdown-code-block-line-height)',
  letterSpacing: '0',
  fontVariantLigatures: 'none',
  fontFeatureSettings: '"liga" 0, "calt" 0',
  tabSize: 4,
};
