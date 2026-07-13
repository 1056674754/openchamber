import { describe, expect, test } from 'bun:test';

import {
  getViewportContentForMobileKeyboardMode,
  normalizeMobileKeyboardMode,
  supportsMobileKeyboardResizeContent,
} from './mobileKeyboardMode';

describe('mobile keyboard mode', () => {
  test('defaults to resize-content', () => {
    expect(normalizeMobileKeyboardMode(undefined)).toBe('resize-content');
    expect(getViewportContentForMobileKeyboardMode(undefined)).toContain('interactive-widget=resizes-content');
  });

  test('keeps native mode available as an explicit override', () => {
    expect(normalizeMobileKeyboardMode('native')).toBe('native');
    expect(getViewportContentForMobileKeyboardMode('native')).not.toContain('interactive-widget');
  });

  test('allows resize-content on iOS-class browsers', () => {
    expect(supportsMobileKeyboardResizeContent()).toBe(true);
  });
});
