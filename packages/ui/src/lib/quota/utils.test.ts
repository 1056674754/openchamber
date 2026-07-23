import { describe, expect, test } from 'bun:test';

import {
  calculateExpectedUsageMarkerPercent,
  clampPercent,
  formatPercent,
} from './utils';

describe('quota utils', () => {
  test('treats non-finite percentages as missing', () => {
    expect(clampPercent(Infinity)).toBeNull();
    expect(clampPercent(-Infinity)).toBeNull();

    expect(formatPercent(Infinity)).toBe('-');
    expect(formatPercent(-Infinity)).toBe('-');
  });

  test('calculates an expected-usage marker for a five-hour window', () => {
    // Given 20% of a quota window has elapsed
    const elapsedRatio = 0.2;

    // When the marker is requested in used and remaining modes
    const usedMarker = calculateExpectedUsageMarkerPercent(elapsedRatio, 'usage');
    const remainingMarker = calculateExpectedUsageMarkerPercent(elapsedRatio, 'remaining');

    // Then both modes expose the same time budget from opposite directions
    expect(usedMarker).toBe(20);
    expect(remainingMarker).toBe(80);
  });

  test('does not calculate a marker without a valid quota window', () => {
    // Given a quota metric without a computable elapsed ratio
    const elapsedRatio = null;

    // When the expected marker is requested
    const marker = calculateExpectedUsageMarkerPercent(elapsedRatio, 'usage');

    // Then the progress bar remains unmarked
    expect(marker).toBeNull();
  });
});
