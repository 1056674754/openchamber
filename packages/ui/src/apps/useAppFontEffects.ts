import React from 'react';
import { useFontPreferences } from '@/hooks/useFontPreferences';
import { CJK_MONO_FONT_FAMILIES, CODE_FONT_OPTION_MAP, DEFAULT_MONO_FONT, DEFAULT_UI_FONT, UI_FONT_OPTION_MAP } from '@/lib/fontOptions';
import { installCodeFontDiagnostics, loadMonoFont, loadUiFont } from '@/lib/fontLoader';

export function useAppFontEffects() {
  const { uiFont, monoFont } = useFontPreferences();

  React.useEffect(() => {
    if (typeof document === 'undefined') {
      return;
    }

    const root = document.documentElement;
    const uiStack = UI_FONT_OPTION_MAP[uiFont]?.stack ?? UI_FONT_OPTION_MAP[DEFAULT_UI_FONT].stack;
    const monoStack = CODE_FONT_OPTION_MAP[monoFont]?.stack ?? CODE_FONT_OPTION_MAP[DEFAULT_MONO_FONT].stack;
    installCodeFontDiagnostics();
    void loadUiFont(uiFont);
    void loadMonoFont(monoFont);

    root.style.setProperty('--font-sans', uiStack);
    root.style.setProperty('--font-heading', uiStack);
    root.style.setProperty('--font-family-sans', uiStack);
    root.style.setProperty('--font-mono', monoStack);
    root.style.setProperty('--font-mono-cjk', `${CJK_MONO_FONT_FAMILIES}, var(--font-mono)`);
    root.style.setProperty('--font-family-mono', monoStack);
    root.style.setProperty('--ui-regular-font-weight', '400');

    if (document.body) {
      document.body.style.fontFamily = uiStack;
    }
  }, [uiFont, monoFont]);
}
