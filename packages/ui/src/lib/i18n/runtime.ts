export type Locale = 'en' | 'zh-CN' | 'zh-TW' | 'uk' | 'es' | 'pt-BR' | 'ko' | 'pl' | 'ja' | 'de' | 'tr' | 'nl';

import { getSafeStorage } from '@/stores/utils/safeStorage';

export const LOCALES = ['en', 'zh-CN', 'zh-TW', 'uk', 'es', 'pt-BR', 'ko', 'pl', 'ja', 'de', 'tr', 'nl'] as const satisfies readonly Locale[];

export const DEFAULT_LOCALE: Locale = 'en';

export const LOCALE_LABEL_KEYS: Record<Locale, 'common.language.english' | 'common.language.simplifiedChinese' | 'common.language.traditionalChinese' | 'common.language.ukrainian' | 'common.language.spanish' | 'common.language.brazilianPortuguese' | 'common.language.korean' | 'common.language.polish' | 'common.language.japanese' | 'common.language.german' | 'common.language.turkish' | 'common.language.dutch'> = {
  en: 'common.language.english',
  'zh-CN': 'common.language.simplifiedChinese',
  'zh-TW': 'common.language.traditionalChinese',
  uk: 'common.language.ukrainian',
  es: 'common.language.spanish',
  'pt-BR': 'common.language.brazilianPortuguese',
  ko: 'common.language.korean',
  pl: 'common.language.polish',
  ja: 'common.language.japanese',
  de: 'common.language.german',
  tr: 'common.language.turkish',
  nl: 'common.language.dutch',
};

export const LOCALE_STORAGE_KEY = 'openchamber.i18n.v1';

type StoredLocale = {
  locale?: unknown;
};

export function normalizeLocale(value: string | undefined | null): Locale {
  if (!value) {
    return DEFAULT_LOCALE;
  }

  const normalized = value.toLowerCase().replace(/_/g, '-');
  if (normalized === 'zh-cn' || normalized === 'zh-hans' || normalized.startsWith('zh-hans-')) {
    return 'zh-CN';
  }
  if (normalized === 'zh-tw' || normalized === 'zh-hant' || normalized.startsWith('zh-hant-')) {
    return 'zh-TW';
  }
  if (normalized.startsWith('zh')) {
    return 'zh-CN';
  }
  if (normalized.startsWith('en')) {
    return 'en';
  }
  if (normalized === 'uk' || normalized.startsWith('uk-') || normalized === 'ua' || normalized.startsWith('ua-')) {
    return 'uk';
  }
  if (normalized === 'es' || normalized.startsWith('es-')) {
    return 'es';
  }
  if (normalized === 'pt' || normalized === 'pt-br' || normalized.startsWith('pt-br-')) {
    return 'pt-BR';
  }
  if (normalized === 'ko' || normalized.startsWith('ko-')) {
    return 'ko';
  }
  if (normalized === 'pl' || normalized.startsWith('pl-')) {
    return 'pl';
  }
  if (normalized === 'ja' || normalized.startsWith('ja-')) {
    return 'ja';
  }
  if (normalized === 'de' || normalized.startsWith('de-')) {
    return 'de';
  }
  if (normalized === 'tr' || normalized.startsWith('tr-')) {
    return 'tr';
  }
  if (normalized === 'nl' || normalized.startsWith('nl-')) {
    return 'nl';
  }
  return DEFAULT_LOCALE;
}

const getLocaleStorage = (): { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void } | null => {
  if (typeof window === 'undefined') {
    return null;
  }
  return getSafeStorage();
};

export function readStoredLocale(): Locale | undefined {
  const storage = getLocaleStorage();
  if (!storage) {
    return undefined;
  }

  try {
    const raw = storage.getItem(LOCALE_STORAGE_KEY);
    if (!raw) {
      return undefined;
    }
    const parsed = JSON.parse(raw) as StoredLocale;
    return typeof parsed.locale === 'string' ? normalizeLocale(parsed.locale) : undefined;
  } catch {
    return undefined;
  }
}

export function writeStoredLocale(locale: Locale): void {
  const storage = getLocaleStorage();
  if (!storage) {
    return;
  }

  try {
    storage.setItem(LOCALE_STORAGE_KEY, JSON.stringify({ locale }));
  } catch {
    return;
  }
}

export function detectInitialLocale(): Locale {
  const stored = readStoredLocale();
  if (stored) {
    return stored;
  }

  return DEFAULT_LOCALE;
}
