import { describe, expect, test } from 'bun:test';

import {
  FILL_VIEWPORT,
  MAX_VIEWPORT_SIZE,
  MIN_VIEWPORT_SIZE,
  VIEWPORT_PRESETS,
  clampViewportSize,
  fitViewport,
  isViewportMode,
  presetViewport,
  rotateViewport,
  viewportForMode,
  viewportSize,
  viewportSummary,
} from './viewport';

describe('Browser viewport', () => {
  test('fill has no fixed size', () => {
    expect(viewportSize(FILL_VIEWPORT)).toBeNull();
    expect(fitViewport(FILL_VIEWPORT, { width: 800, height: 600 })).toBeNull();
  });

  test('clamps custom sizes to the supported layout range', () => {
    expect(clampViewportSize(10)).toBe(MIN_VIEWPORT_SIZE);
    expect(clampViewportSize(99_999)).toBe(MAX_VIEWPORT_SIZE);
    expect(clampViewportSize(390.6)).toBe(391);
  });

  test('keeps the requested CSS size and only scales its presentation down', () => {
    expect(fitViewport({ kind: 'custom', width: 400, height: 800 }, { width: 200, height: 400 }))
      .toEqual({ width: 400, height: 800, scale: 0.5 });
    expect(fitViewport({ kind: 'custom', width: 400, height: 800 }, { width: 1200, height: 1200 })?.scale)
      .toBe(1);
  });

  test('resolves, rotates, and validates named modes', () => {
    expect(presetViewport('iphone-14')).toEqual({ kind: 'preset', id: 'iphone-14', width: 390, height: 844 });
    expect(rotateViewport(viewportForMode('mobile'))).toEqual({ kind: 'custom', width: 844, height: 390 });
    expect(isViewportMode('tablet')).toBe(true);
    expect(isViewportMode('phone')).toBe(false);
    expect(VIEWPORT_PRESETS.every((preset) => clampViewportSize(preset.width) === preset.width)).toBe(true);
  });

  test('reports the same vocabulary accepted from the agent', () => {
    expect(viewportSummary(viewportForMode('mobile'))).toEqual({ mode: 'mobile', width: 390, height: 844 });
    expect(viewportSummary(FILL_VIEWPORT)).toEqual({ mode: 'fill', width: null, height: null });
  });
});
