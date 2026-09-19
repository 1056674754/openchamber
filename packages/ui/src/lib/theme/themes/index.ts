import type { Theme } from '@/types/theme';
import { presetThemes } from './presets';
import { withPrColors } from './prColors';
import { requireTheme } from '../definition';
import flexokiLightRaw from './flexoki-light.json';
import flexokiDarkRaw from './flexoki-dark.json';
import openchamberLightRaw from './fields-of-the-shire-light.json';
import openchamberDarkRaw from './fields-of-the-shire-dark.json';
import openchamberHybridLightRaw from './openchamber-hybrid-light.json';
import openchamberHybridDarkRaw from './openchamber-hybrid-dark.json';

export const flexokiLightTheme = withPrColors(requireTheme(flexokiLightRaw));
export const flexokiDarkTheme = withPrColors(requireTheme(flexokiDarkRaw));
export const openchamberLightTheme = withPrColors(requireTheme(openchamberLightRaw));
export const openchamberDarkTheme = withPrColors(requireTheme(openchamberDarkRaw));
export const openchamberHybridLightTheme = withPrColors(requireTheme(openchamberHybridLightRaw));
export const openchamberHybridDarkTheme = withPrColors(requireTheme(openchamberHybridDarkRaw));

export const DEFAULT_LIGHT_THEME_ID = 'openchamber-hybrid-light' as const;
export const DEFAULT_DARK_THEME_ID = 'openchamber-hybrid-dark' as const;

export const themes: Theme[] = [
  openchamberHybridLightTheme,
  openchamberHybridDarkTheme,
  openchamberLightTheme,
  openchamberDarkTheme,
  flexokiLightTheme,
  flexokiDarkTheme,
  ...presetThemes.filter(
    (theme) => theme.metadata.id !== 'openchamber-light' && theme.metadata.id !== 'openchamber-dark',
  ),
];

export function getThemeById(id: string): Theme | undefined {
  // Back-compat for a short-lived rename.
  const resolvedId =
    id === 'app-light' ? 'flexoki-light' :
    id === 'app-dark' ? 'flexoki-dark' :
    id;

  return themes.find(theme => theme.metadata.id === resolvedId);
}

export function getDefaultTheme(prefersDark: boolean): Theme {
  const variant: Theme['metadata']['variant'] = prefersDark ? 'dark' : 'light';

  const defaultId = prefersDark ? DEFAULT_DARK_THEME_ID : DEFAULT_LIGHT_THEME_ID;
  const defaultTheme = getThemeById(defaultId);
  if (defaultTheme && defaultTheme.metadata.variant === variant) {
    return defaultTheme;
  }

  return themes.find((theme) => theme.metadata.variant === variant) ?? themes[0] ?? flexokiLightTheme;
}
