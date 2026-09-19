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

describe('Catppuccin built-in palettes', () => {
  test('maps the dark variant to official Mocha roles', () => {
    const theme = getThemeById('catppuccin-dark');
    expect({
      primary: theme?.colors.primary.base,
      surfaceBackground: theme?.colors.surface.background,
      surfaceMuted: theme?.colors.surface.muted,
      surfaceMutedForeground: theme?.colors.surface.mutedForeground,
    }).toEqual({
      primary: '#cba6f7',
      surfaceBackground: '#1e1e2e',
      surfaceMuted: '#181825',
      surfaceMutedForeground: '#a6adc8',
    });
    expect(theme?.colors.syntax.base.string).toBe('#a6e3a1');
    expect(theme?.colors.syntax.base.keyword).toBe('#cba6f7');
  });

  test('maps the light variant to official Latte roles', () => {
    const theme = getThemeById('catppuccin-light');
    expect({
      primary: theme?.colors.primary.base,
      surfaceBackground: theme?.colors.surface.background,
      surfaceMuted: theme?.colors.surface.muted,
      surfaceMutedForeground: theme?.colors.surface.mutedForeground,
    }).toEqual({
      primary: '#7130c7',
      surfaceBackground: '#eff1f5',
      surfaceMuted: '#e6e9ef',
      surfaceMutedForeground: '#5c5f77',
    });
    expect(theme?.colors.syntax.base.string).toBe('#40a02b');
  });
});
