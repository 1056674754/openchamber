import { describe, expect, test } from 'bun:test';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  checkPluginLoaded,
  getPluginRuntimeStatusFailureReason,
  getMissingRequiredPluginRuntimeFeatures,
  normalizePluginRuntimeStatus,
  readOpenChamberPluginOptions,
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

  test('enables system prompt optimization only for a strict true setting', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'openchamber-plugin-options-'));
    const settingsPath = join(directory, 'settings.json');

    await writeFile(settingsPath, JSON.stringify({ optimizeSystemPrompt: true }), 'utf8');
    expect(readOpenChamberPluginOptions(settingsPath)).toEqual({
      optimizeSystemPrompt: true,
    });

    await writeFile(settingsPath, JSON.stringify({ optimizeSystemPrompt: 'true' }), 'utf8');
    expect(readOpenChamberPluginOptions(settingsPath)).toBeUndefined();
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

describe('v2-track plugin probe (spine finale)', () => {
  test('reads loaded state from the OpenCode 2 plugin inventory instead of the v1 tool ids', async () => {
    const status = await checkPluginLoaded('http://127.0.0.1:4096', {}, {
      mode: 'v2',
      fetch: async (url) => {
        expect(url).toBe('http://127.0.0.1:4096/api/plugin');
        return Response.json({
          location: { directory: '/tmp' },
          data: [
            { id: 'other-plugin', state: { status: 'active' } },
            { id: '@openchamber/plugin', state: { status: 'active' } },
          ],
        });
      },
      readRuntimeStatus: () => null,
    });

    expect(status.loaded).toBe(true);
    expect(status.protocolMode).toBe('v2');
    expect(status.plugins).toEqual(['other-plugin', '@openchamber/plugin']);
  });

  test('reports a missing or failed inventory entry without probing v1 paths', async () => {
    const missing = await checkPluginLoaded('http://127.0.0.1:4096', {}, {
      mode: 'v2',
      fetch: async (url) => {
        expect(url).toBe('http://127.0.0.1:4096/api/plugin');
        return Response.json({ data: [{ id: 'other-plugin', state: { status: 'active' } }] });
      },
      readRuntimeStatus: () => null,
    });
    expect(missing.loaded).toBe(false);
    expect(missing.reason).toBe('plugin not registered');

    const failed = await checkPluginLoaded('http://127.0.0.1:4096', {}, {
      mode: 'v2',
      fetch: async () => Response.json({
        data: [{ id: '@openchamber/plugin', state: { status: 'failed', error: 'boom' } }],
      }),
      readRuntimeStatus: () => null,
    });
    expect(failed.loaded).toBe(false);
    expect(failed.reason).toBe('plugin failed: boom');
  });

  test('keeps the v2 answer loaded when the v1 runtime status file is absent', async () => {
    const status = await checkPluginLoaded('http://127.0.0.1:4096', {}, {
      mode: 'v2',
      fetch: async () => Response.json({ data: [{ id: '@openchamber/plugin', state: { status: 'active' } }] }),
      readRuntimeStatus: () => null,
    });
    expect(status.loaded).toBe(true);
    expect(status.features).toBeUndefined();
  });

  test('still honours a fresh runtime status as feature enrichment', async () => {
    const runtimeStatus = normalizePluginRuntimeStatus({
      id: '@openchamber/plugin',
      version: 1,
      loadedAt: '2026-10-03T00:00:00.000Z',
      pid: 42,
      features: { liveSteer: true, imageFallback: true },
      tools: ['describe_image'],
    });
    const status = await checkPluginLoaded('http://127.0.0.1:4096', {}, {
      mode: 'v2',
      expectedPid: 42,
      fetch: async () => Response.json({ data: [{ id: '@openchamber/plugin', state: { status: 'active' } }] }),
      readRuntimeStatus: () => runtimeStatus,
    });
    expect(status.loaded).toBe(true);
    expect(status.features).toEqual({ liveSteer: true, imageFallback: true });
  });

  test('answers HTTP failures on the v2 probe path without falling back to v1', async () => {
    const status = await checkPluginLoaded('http://127.0.0.1:4096', {}, {
      mode: 'v2',
      fetch: async (url) => {
        expect(url).toBe('http://127.0.0.1:4096/api/plugin');
        return new Response(null, { status: 500 });
      },
    });
    expect(status.loaded).toBe(false);
    expect(status.reason).toBe('HTTP 500');
    expect(status.protocolMode).toBe('v2');
  });
});
