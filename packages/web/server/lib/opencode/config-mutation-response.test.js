import { describe, expect, test } from 'bun:test';

import { buildDeferredRestartResponse } from './config-mutation-response.js';

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
});
