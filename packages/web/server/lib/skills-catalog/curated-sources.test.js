import { describe, expect, it } from 'vitest';
import { getCuratedSkillsSources } from './curated-sources.js';

describe('getCuratedSkillsSources', () => {
  it('uses the public ClawHub name', () => {
    const source = getCuratedSkillsSources().find((item) => item.id === 'clawdhub');
    expect(source?.label).toBe('ClawHub');
  });
});
