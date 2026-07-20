import { describe, expect, test } from 'bun:test';
import type { Part } from '@opencode-ai/sdk/v2';

import { areRenderRelevantPartsEqual } from './renderCompare';

type ShellTextPart = Extract<Part, { type: 'text' }> & {
  readonly shellAction: {
    readonly command: string;
    readonly output: string;
    readonly status: string;
  };
};

const shellPart = (status: string, output: string): ShellTextPart => ({
  id: 'shell-part',
  sessionID: 'shell-session',
  messageID: 'shell-message',
  type: 'text',
  text: '/shell',
  shellAction: {
    command: 'bun test',
    output,
    status,
  },
});

describe('areRenderRelevantPartsEqual', () => {
  test('detects live shell status and output changes', () => {
    const running = [shellPart('running', 'first line')];
    const completed = [shellPart('completed', 'first line\nsecond line')];

    expect(areRenderRelevantPartsEqual(running, completed)).toBe(false);
  });
});
