import { describe, expect, test } from 'bun:test';
import { mergePartialSkills } from './useSkillsStore';

const skill = (name: string, renamable = false) => ({
  name,
  path: `/skills/${name}`,
  scope: 'user' as const,
  source: 'opencode' as const,
  description: name,
  group: undefined,
  renamable,
});

describe('mergePartialSkills', () => {
  test('a partial list keeps previously known non-managed skills', () => {
    const previous = [skill('OpenCode'), skill('from-config'), skill('deleted-managed', true)];
    const partial = [skill('repo-local')];
    expect(mergePartialSkills(partial, previous).map((entry) => entry.name))
      .toEqual(['repo-local', 'OpenCode', 'from-config']);
  });

  test('managed skills missing from the disk scan are really gone', () => {
    const previous = [skill('deleted-managed', true)];
    expect(mergePartialSkills([], previous)).toEqual([]);
  });

  test('a partial entry wins over the carried previous copy', () => {
    const refreshed = skill('from-config');
    const stale = skill('from-config');
    expect(mergePartialSkills([refreshed], [stale])).toEqual([refreshed]);
  });
});
