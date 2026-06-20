import { describe, expect, test } from 'bun:test';

import {
  getPluginRuntimeStatusFailureReason,
  getMissingRequiredPluginRuntimeFeatures,
  normalizePluginRuntimeStatus,
} from './plugin-bootstrap.js';

describe('plugin runtime status validation', () => {
  test('accepts a status with the live steer feature', () => {
    const status = normalizePluginRuntimeStatus({
      id: '@openchamber/plugin',
      version: 1,
      loadedAt: '2026-06-19T00:00:00.000Z',
      features: { liveSteer: true, imageFallback: true },
      tools: ['describe_image', 'save_image_analysis'],
    });

    expect(status?.id).toBe('@openchamber/plugin');
    expect(getMissingRequiredPluginRuntimeFeatures(status)).toEqual([]);
  });

  test('flags an old plugin status that lacks live steer', () => {
    const status = normalizePluginRuntimeStatus({
      id: '@openchamber/plugin',
      version: 1,
      loadedAt: '2026-06-19T00:00:00.000Z',
      features: { imageFallback: true },
      tools: ['describe_image', 'save_image_analysis'],
    });

    expect(getMissingRequiredPluginRuntimeFeatures(status)).toEqual(['liveSteer']);
  });

  test('rejects non-object runtime status payloads', () => {
    expect(normalizePluginRuntimeStatus(null)).toBeNull();
    expect(normalizePluginRuntimeStatus('loaded')).toBeNull();
  });

  test('rejects stale runtime status from another managed OpenCode pid', () => {
    const status = normalizePluginRuntimeStatus({
      id: '@openchamber/plugin',
      version: 1,
      loadedAt: '2026-06-19T00:00:00.000Z',
      pid: 100,
      features: { liveSteer: true, imageFallback: true },
      tools: ['describe_image', 'save_image_analysis'],
    });

    expect(getPluginRuntimeStatusFailureReason(status, 200)).toBe('runtime pid mismatch: 100 !== 200');
  });
});
