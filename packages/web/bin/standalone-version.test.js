import { describe, expect, test } from 'bun:test';

import packageMetadata from '../package.json';
import { STANDALONE_VERSION } from './standalone-version.mjs';

describe('standalone binary version', () => {
  test('uses the Web package version', () => {
    expect(STANDALONE_VERSION).toBe(packageMetadata.version);
  });
});
