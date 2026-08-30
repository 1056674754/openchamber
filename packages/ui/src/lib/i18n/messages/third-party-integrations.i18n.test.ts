import { describe, expect, test } from 'bun:test';

import { thirdPartyIntegrationI18n } from './third-party-integrations.i18n';

const supportedLocales = [
  'en',
  'de',
  'es',
  'ja',
  'ko',
  'pl',
  'pt-BR',
  'tr',
  'uk',
  'zh-CN',
  'zh-TW',
] as const;

describe('third-party integration translations', () => {
  test('keeps every runtime locale aligned to the English key contract', () => {
    const englishKeys = Object.keys(thirdPartyIntegrationI18n.en).sort();

    for (const locale of supportedLocales) {
      expect(Object.keys(thirdPartyIntegrationI18n[locale]).sort()).toEqual(englishKeys);
    }
  });

  test('does not retain the retired Command Code integration copy', () => {
    expect(Object.keys(thirdPartyIntegrationI18n.en).some((key) => key.includes('Commandcode'))).toBe(false);
  });
});
