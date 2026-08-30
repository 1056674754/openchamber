import { describe, expect, test } from 'bun:test';

import {
  formatMobileConnectDebugEntry,
  getMobileConnectDebugEntries,
  getMobileConnectDebugText,
  recordMobileConnectDebug,
} from './mobileConnectionDebug';

describe('mobile connection diagnostics', () => {
  test('formats copyable entries without persisting them', () => {
    recordMobileConnectDebug('probe:health', '{"status":503}');
    const entry = getMobileConnectDebugEntries().at(-1)!;
    expect(formatMobileConnectDebugEntry(entry)).toContain('probe:health {"status":503}');
    expect(getMobileConnectDebugText()).toContain('probe:health {"status":503}');
  });

  test('caps the current-run trail', () => {
    for (let index = 0; index < 320; index += 1) {
      recordMobileConnectDebug(`step:${index}`, '{}');
    }
    const entries = getMobileConnectDebugEntries();
    expect(entries.length).toBe(300);
    expect(entries[0]?.step).toBe('step:20');
  });
});
