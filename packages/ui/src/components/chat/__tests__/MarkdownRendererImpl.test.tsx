import { describe, expect, test } from 'bun:test';
import { CODE_SHARED_STYLE, MARKDOWN_CODE_BODY_CLASSNAME } from '../markdownCodeStyle';

describe('MarkdownRenderer code blocks', () => {
  test('keeps syntax highlighted pre elements from becoming scroll containers', () => {
    expect(CODE_SHARED_STYLE.overflow).toBe('visible');
    expect(CODE_SHARED_STYLE.overflowX).toBe('visible');
    expect(CODE_SHARED_STYLE.overflowY).toBe('visible');
  });

  test('keeps code block body horizontally scrollable only', () => {
    const classes = MARKDOWN_CODE_BODY_CLASSNAME.split(/\s+/);

    expect(classes.includes('overflow-x-auto')).toBe(true);
    expect(classes.includes('overflow-y-hidden')).toBe(true);
  });
});
