import { describe, expect, test } from 'bun:test';

import { dict as enDict } from './messages/en';
import { dict as zhCnDict } from './messages/zh-CN';
import { formatMessage, type I18nDictionary } from './store';

describe('runtime fallback approval copy', () => {
  function expectCandidateModel(dictionary: I18nDictionary): void {
    const candidateModel = 'zhipuai-coding-plan/glm-5.2';
    const params = { model: candidateModel };

    expect(formatMessage(dictionary, 'runtimeFallback.approval.title', params))
      .toContain(candidateModel);
    expect(formatMessage(dictionary, 'runtimeFallback.approval.switchNow', params))
      .toContain(candidateModel);
  }

  test('shows the candidate model in English title and primary action', () => {
    expectCandidateModel(enDict);
  });

  test('shows the candidate model in Simplified Chinese title and primary action', () => {
    expectCandidateModel(zhCnDict);
  });
});
