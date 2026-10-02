// Language the walkthrough prose is written in.
//
// This is the server's own list rather than an import from the UI package: the
// server cannot reach `packages/ui`, and the two lists answer different
// questions anyway. The UI list is "which locales do we have a dictionary
// for"; this one is "which languages may we ask a model to write in", and it
// needs the English endonym-free name that goes into the prompt.
//
// The tags match the UI's `Locale` union so the picker can pass its own value
// straight through. A tag we do not know resolves to English, which is exactly
// what the feature did before the setting existed.

export const DEFAULT_LANGUAGE = 'en';

const LANGUAGE_NAMES = {
  en: 'English',
  'zh-CN': 'Simplified Chinese',
  'zh-TW': 'Traditional Chinese',
  uk: 'Ukrainian',
  es: 'Spanish',
  'pt-BR': 'Brazilian Portuguese',
  ko: 'Korean',
  pl: 'Polish',
  ja: 'Japanese',
  de: 'German',
  tr: 'Turkish',
  // The interface's 12th locale (the server list must track the UI's
  // LOCALES array — the drift test below exists for exactly this).
  nl: 'Dutch',
};

export function normalizeLanguage(value) {
  if (typeof value !== 'string' || !value) return DEFAULT_LANGUAGE;
  if (Object.hasOwn(LANGUAGE_NAMES, value)) return value;

  const normalized = value.toLowerCase().replace(/_/g, '-');
  const match = Object.keys(LANGUAGE_NAMES).find((tag) => {
    const lower = tag.toLowerCase();
    return lower === normalized || normalized.startsWith(`${lower}-`);
  });
  if (match) return match;

  const base = normalized.split('-')[0];
  const baseMatch = Object.keys(LANGUAGE_NAMES).find((tag) => tag.toLowerCase() === base);
  return baseMatch ?? DEFAULT_LANGUAGE;
}

export function languageName(language) {
  return LANGUAGE_NAMES[language] ?? LANGUAGE_NAMES[DEFAULT_LANGUAGE];
}

export const __testing = { LANGUAGE_NAMES };
