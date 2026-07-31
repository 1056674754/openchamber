import { describe, expect, test } from 'bun:test';

import {
  formatCodeSelectionMarkdown,
  selectionNodesToMarkdown,
  trimSelectionValue,
  wrapMarkdownSelectionForChat,
  type SelectionNode,
} from './selectionMarkdown';

const multiline = (...lines: string[]): string => lines.join('\n');
const text = (value: string): SelectionNode => ({ type: 'text', value });
const element = (
  tag: string,
  children: SelectionNode[],
  options: Partial<Omit<Extract<SelectionNode, { type: 'element' }>, 'type' | 'tag' | 'children'>> = {},
): SelectionNode => ({
  type: 'element',
  tag,
  className: '',
  href: '',
  component: '',
  markdownLanguage: '',
  isMarkdownBlock: false,
  isCodeLines: false,
  isCodeLineNumber: false,
  isGeneratedCodeDecoration: false,
  children,
  ...options,
});

const codeLine = (number: number, content: string): SelectionNode => element('span', [
  element('span', [text(String(number))], { isCodeLineNumber: true }),
  element('span', [text(content)]),
]);

const markdownBlock = (children: SelectionNode[]): SelectionNode => (
  element('div', children, { isMarkdownBlock: true })
);

const codeWrapper = (lines: string[], language = 'ts'): SelectionNode => element('div', [
  element('div', [text(language)]),
  element('div', [
    element('pre', [
      element('code', lines.flatMap((line, index) => [
        codeLine(index + 12, line),
        ...(index < lines.length - 1 ? [element('span', [text('\n')])] : []),
      ]), { isCodeLines: true }),
    ], { markdownLanguage: language }),
  ]),
], { component: 'markdown-code' });

describe('selectionNodesToMarkdown', () => {
  test('serializes a complete grid code block without its header or line numbers', () => {
    expect(selectionNodesToMarkdown([codeWrapper(['range.cloneContents()', 'next()'])], '')).toBe(multiline(
      '```ts',
      'range.cloneContents()',
      'next()',
      '```',
    ));
  });

  test('removes generated missing-file decorations from copied source', () => {
    const source = element('div', [
      element('pre', [
        element('code', [
          codeLine(1, 'process.env'),
          element('span', [text('✗')], { isGeneratedCodeDecoration: true }),
          text('["TOKEN"]'),
        ], { isCodeLines: true }),
      ], { markdownLanguage: 'js' }),
    ], { component: 'markdown-code' });

    expect(selectionNodesToMarkdown([source], '')).toBe(multiline(
      '```js',
      'process.env["TOKEN"]',
      '```',
    ));
  });

  test('preserves a code block nested between Markdown block wrappers', () => {
    const nodes = [
      markdownBlock([element('p', [
        text('Method:'),
        element('code', [text('Selection.toString()')]),
        text('. Add to Chat uses a cloned range.'),
      ])]),
      markdownBlock([codeWrapper(['range.cloneContents()'])]),
      markdownBlock([element('p', [text('Following explanation')])]),
    ];

    expect(selectionNodesToMarkdown(nodes, '')).toBe(multiline(
      'Method:`Selection.toString()`. Add to Chat uses a cloned range.',
      '',
      '```ts',
      'range.cloneContents()',
      '```',
      '',
      'Following explanation',
    ));
  });

  test('preserves a partial code block selected before prose', () => {
    expect(selectionNodesToMarkdown([
      codeWrapper(['range.cloneContents()']),
      element('p', [text('Following explanation')]),
    ], '')).toBe(multiline(
      '```ts',
      'range.cloneContents()',
      '```',
      '',
      'Following explanation',
    ));
  });
});

describe('formatCodeSelectionMarkdown', () => {
  test('preserves indentation and blank lines', () => {
    expect(formatCodeSelectionMarkdown(multiline(
      'if (ready) {',
      '  run();',
      '',
      '  stop();',
      '}',
    ), 'ts')).toBe(multiline(
      '```ts',
      'if (ready) {',
      '  run();',
      '',
      '  stop();',
      '}',
      '```',
    ));
  });

  test('normalizes line endings without duplicating a trailing newline', () => {
    expect(formatCodeSelectionMarkdown('first\r\nsecond\r\n', 'text')).toBe(multiline(
      '```text',
      'first',
      'second',
      '```',
    ));
  });

  test('uses a longer fence when selected code contains backtick fences', () => {
    expect(formatCodeSelectionMarkdown(multiline('before', '```', 'after'), 'md')).toBe(multiline(
      '````md',
      'before',
      '```',
      'after',
      '````',
    ));
  });

  test('preserves punctuation in language identifiers', () => {
    expect(selectionNodesToMarkdown([codeWrapper(['std::vector<int> values;'], 'c++')], '')).toBe(multiline(
      '```c++',
      'std::vector<int> values;',
      '```',
    ));
  });
});

describe('trimSelectionValue', () => {
  test('normalizes line endings before trimming the selection', () => {
    expect(trimSelectionValue('  first\r\nsecond  ')).toBe(multiline('first', 'second'));
  });
});

describe('wrapMarkdownSelectionForChat', () => {
  test('uses a longer outer fence when the selection contains fenced code', () => {
    const selectedMarkdown = multiline('```ts', 'run();', '```');

    expect(wrapMarkdownSelectionForChat(selectedMarkdown)).toBe(multiline(
      '````md',
      '```ts',
      'run();',
      '```',
      '````',
    ));
  });
});
