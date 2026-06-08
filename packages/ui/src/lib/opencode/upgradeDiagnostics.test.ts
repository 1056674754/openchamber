import { describe, expect, test } from 'bun:test';

import {
  formatOpenCodeUpgradeCopyText,
  resolveOpenCodeUpgradeError,
} from './upgradeDiagnostics';

describe('OpenCode upgrade diagnostics', () => {
  test('uses explicit copy text when the server provides it', () => {
    expect(
      formatOpenCodeUpgradeCopyText(
        {
          error: 'Upgrade failed for brew (exit code 1)',
          copyText: 'brew stderr\nfull diagnostic output',
        },
        'Upgrade failed',
      ),
    ).toBe('brew stderr\nfull diagnostic output');
  });

  test('formats package manager output for clipboard diagnostics', () => {
    const text = formatOpenCodeUpgradeCopyText(
      {
        error: 'Upgrade failed for brew (exit code 1)',
        rpcTarget: 'local',
        path: '/api/opencode/upgrade',
        method: 'POST',
        timeoutMs: 600000,
        manager: 'brew',
        command: 'brew upgrade opencode',
        exitCode: 1,
        stderr: 'Error: opencode 1.2.3 already installed',
        stdout: 'Running `brew update --auto-update`...',
      },
      'Upgrade failed',
      { target: '1.2.4', httpStatus: 500, httpStatusText: 'Internal Server Error' },
    );

    expect(text).toContain('OpenCode upgrade failed');
    expect(text).toContain('Error: Upgrade failed for brew (exit code 1)');
    expect(text).toContain('Target: 1.2.4');
    expect(text).toContain('HTTP status: 500 Internal Server Error');
    expect(text).toContain('RPC target:\nlocal');
    expect(text).toContain('Path:\n/api/opencode/upgrade');
    expect(text).toContain('Method:\nPOST');
    expect(text).toContain('Timeout ms:\n600000');
    expect(text).toContain('Manager:\nbrew');
    expect(text).toContain('Command:\nbrew upgrade opencode');
    expect(text).toContain('Exit code:\n1');
    expect(text).toContain('stderr:\nError: opencode 1.2.3 already installed');
    expect(text).toContain('stdout:\nRunning `brew update --auto-update`...');
  });

  test('falls back to message before the generic error text', () => {
    expect(resolveOpenCodeUpgradeError({ message: 'brew returned no formula' }, 'Upgrade failed'))
      .toBe('brew returned no formula');
  });
});
