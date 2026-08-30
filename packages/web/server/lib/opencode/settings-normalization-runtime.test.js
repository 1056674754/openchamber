import { describe, expect, test } from 'vitest';
import os from 'node:os';
import path from 'node:path';

import { createSettingsNormalizationRuntime } from './settings-normalization-runtime.js';

const runtime = createSettingsNormalizationRuntime({
  os,
  path,
  processLike: process,
  realpathSync: (value) => value,
  tunnelBootstrapTtlDefaultMs: 1,
  tunnelBootstrapTtlMinMs: 1,
  tunnelBootstrapTtlMaxMs: 10,
  tunnelSessionTtlDefaultMs: 1,
  tunnelSessionTtlMinMs: 1,
  tunnelSessionTtlMaxMs: 10,
});

describe('settings project defaults normalization', () => {
  test('keeps a project variant only when a valid model is present', () => {
    expect(runtime.sanitizeProjects([
      { id: 'one', path: '/project/one', defaultModel: 'openai/gpt-5', defaultVariant: 'high' },
      { id: 'two', path: '/project/two', defaultVariant: 'high' },
    ])).toEqual([
      { id: 'one', path: '/project/one', defaultModel: 'openai/gpt-5', defaultVariant: 'high' },
      { id: 'two', path: '/project/two' },
    ]);
  });
});
