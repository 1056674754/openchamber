import { describe, expect, it } from 'vitest';

import { createBuildVersion } from './build-version.mjs';

describe('Electron build version', () => {
  it('keeps the merge baseline and appends the sscity build timestamp', () => {
    const builtAt = new Date('2026-07-21T04:05:06.000Z');

    expect(createBuildVersion('1.20.0-sscity', builtAt, 'UTC')).toBe(
      '1.20.0-sscity.20260721-040506',
    );
  });

  it('keeps early-morning timestamps valid for electron-updater semver checks', () => {
    const builtAt = new Date('2026-07-26T17:23:23.000Z'); // Asia/Shanghai 01:23:23

    const version = createBuildVersion('1.20.0-sscity', builtAt, 'Asia/Shanghai');
    expect(version).toBe('1.20.0-sscity.20260727-012323');
    expect(version.includes('.012323')).toBe(false);
  });

  it('rejects a source version that could misrepresent the merge baseline', () => {
    expect(() => createBuildVersion('1.13.4-sscity', new Date(), 'UTC')).toThrow(
      'OpenChamber build version must start with 1.20.0-sscity',
    );
  });
});
