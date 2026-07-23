import { describe, expect, test } from 'bun:test';
import { detectConflicts } from './conflicts.js';

describe('subscription conflicts', () => {
  test('reports every present provider env var for a non-env credential', () => {
    expect(detectConflicts({
      env: ['ANTHROPIC_API_KEY', 'ANTHROPIC_AUTH_TOKEN'],
      auth: { configured: true, source: 'api' },
    }, {
      ANTHROPIC_API_KEY: 'set',
      ANTHROPIC_AUTH_TOKEN: '',
    })).toEqual([
      {
        type: 'env-override',
        message: 'ANTHROPIC_API_KEY is set and may take precedence over stored credentials',
      },
      {
        type: 'env-override',
        message: 'ANTHROPIC_AUTH_TOKEN is set and may take precedence over stored credentials',
      },
    ]);
  });

  test('does not report env-sourced or unconfigured providers', () => {
    expect(detectConflicts({
      env: ['ANTHROPIC_API_KEY'],
      auth: { configured: true, source: 'env' },
    }, { ANTHROPIC_API_KEY: 'set' })).toEqual([]);
    expect(detectConflicts({
      env: ['ANTHROPIC_API_KEY'],
      auth: { configured: false, source: 'none' },
    }, { ANTHROPIC_API_KEY: 'set' })).toEqual([]);
  });
});
