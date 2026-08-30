import { describe, expect, it } from 'vitest';
import { getCuratedSkillsSources } from './curated-sources.js';

describe('getCuratedSkillsSources', () => {
  it('includes the curated GitHub collections', () => {
    const sources = getCuratedSkillsSources();
    expect(sources.map((source) => source.id)).toEqual(expect.arrayContaining([
      'anthropic', 'openai', 'cursor', 'mattpocock',
    ]));
    expect(sources.every((source) => source.sourceType === 'github' || source.id === 'clawdhub')).toBe(true);
  });

  it('uses the public ClawHub name', () => {
    const source = getCuratedSkillsSources().find((item) => item.id === 'clawdhub');
    expect(source?.label).toBe('ClawHub');
  });
});
