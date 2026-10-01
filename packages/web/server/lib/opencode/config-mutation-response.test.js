import { describe, expect, test } from 'bun:test';

import { buildAppliedResponse, buildDeferredRestartResponse } from './config-mutation-response.js';

describe('config mutation response helpers', () => {
  test('includes the authoritative pending restart snapshot', () => {
    const pendingRestart = { count: 1, reasons: ['agent update'] };

    expect(buildDeferredRestartResponse('Saved.', pendingRestart)).toEqual({
      success: true,
      requiresReload: false,
      requiresRestart: true,
      restartDeferred: true,
      pendingRestart,
      message: 'Saved.',
    });
  });

  test('applied response carries plain success plus the mutation details', () => {
    expect(buildAppliedResponse('Agent saved.', { path: '/tmp/agents/x.md', scope: 'project', source: 'md' })).toEqual({
      success: true,
      message: 'Agent saved.',
      path: '/tmp/agents/x.md',
      scope: 'project',
      source: 'md',
    });
  });

  test('applied response omits details when none are given', () => {
    expect(buildAppliedResponse('Saved.')).toEqual({ success: true, message: 'Saved.' });
  });
});
