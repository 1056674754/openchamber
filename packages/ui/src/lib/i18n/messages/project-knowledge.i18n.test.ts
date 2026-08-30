import { describe, expect, test } from 'bun:test';

import { projectKnowledgeI18n } from './project-knowledge.i18n';

const locales = ['en', 'de', 'es', 'ja', 'ko', 'pl', 'pt-BR', 'tr', 'uk', 'zh-CN', 'zh-TW'] as const;

describe('Project knowledge translations', () => {
  test('keeps every runtime locale aligned to the English key contract', () => {
    const englishKeys = Object.keys(projectKnowledgeI18n.en).sort();
    for (const locale of locales) {
      expect(Object.keys(projectKnowledgeI18n[locale]).sort()).toEqual(englishKeys);
    }
  });
});
