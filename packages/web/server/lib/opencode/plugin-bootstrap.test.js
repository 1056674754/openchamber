import { describe, expect, test } from 'bun:test';

import {
  checkPluginLoaded,
  getPluginRuntimeStatusFailureReason,
  getMissingRequiredPluginRuntimeFeatures,
  normalizePluginRuntimeStatus,
  resolveOpenChamberPluginPaths,
} from './plugin-bootstrap.js';

describe('plugin runtime status validation', () => {
  test('resolves every plugin runtime file inside an explicit OpenChamber data directory', () => {
    expect(resolveOpenChamberPluginPaths({
      OPENCHAMBER_DATA_DIR: '/tmp/openchamber-isolated',
      OPENCODE_CONFIG_DIR: '/tmp/opencode-isolated',
    }, '/Users/test')).toEqual({
      overlayDir: '/tmp/openchamber-isolated',
      overlayFile: '/tmp/openchamber-isolated/opencode-overlay.json',
      pluginInstallDir: '/tmp/openchamber-isolated/plugin',
      pluginEntry: '/tmp/openchamber-isolated/opencode-notifier',
      pluginStatusFile: '/tmp/openchamber-isolated/plugin/status.json',
      openCodeConfigDir: '/tmp/opencode-isolated',
    });
  });

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

  test('keeps live steer loaded when only artifact publishing is unavailable', async () => {
    const runtimeStatus = normalizePluginRuntimeStatus({
      id: '@openchamber/plugin',
      version: 1,
      loadedAt: '2026-07-23T13:28:28.674Z',
      pid: 3323,
      features: { liveSteer: true, imageFallback: true },
      tools: ['describe_image', 'search_images', 'save_image_analysis'],
    });

    const status = await checkPluginLoaded('http://127.0.0.1:4096', {}, {
      expectedPid: 3323,
      fetch: async () => Response.json([
        'describe_image',
        'search_images',
        'save_image_analysis',
      ]),
      readRuntimeStatus: () => runtimeStatus,
    });

    expect(status.loaded).toBe(true);
    expect(status.features).toEqual({
      liveSteer: true,
      imageFallback: true,
      artifactPublishing: false,
    });
    expect(status.missingTools).toEqual(['publish_artifact']);
  });
});
