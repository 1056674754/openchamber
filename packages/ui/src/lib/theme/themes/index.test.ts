import { describe, expect, test } from 'bun:test';

import {
  DEFAULT_DARK_THEME_ID,
  DEFAULT_LIGHT_THEME_ID,
  getDefaultTheme,
  getThemeById,
} from './index';

describe('built-in theme defaults', () => {
  test('uses the OpenChamber hybrid themes for new preferences', () => {
    expect(DEFAULT_LIGHT_THEME_ID).toBe('openchamber-hybrid-light');
    expect(DEFAULT_DARK_THEME_ID).toBe('openchamber-hybrid-dark');
    expect(getDefaultTheme(false).metadata.name).toBe('OpenChamber');
    expect(getDefaultTheme(true).metadata.name).toBe('OpenChamber');
  });

  test('keeps the existing fork OpenChamber ids stable for persisted users', () => {
    expect(getThemeById('openchamber-light')?.metadata.name).toBe('Fields of the Shire');
    expect(getThemeById('openchamber-dark')?.metadata.name).toBe('Fields of the Shire');
  });
});
