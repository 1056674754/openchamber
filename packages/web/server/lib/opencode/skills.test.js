import { describe, expect, it } from 'vitest';
import fsPromises from 'fs/promises';
import os from 'os';
import path from 'path';
import { getSkillSources, mergeDiscoveredSkills } from './skills.js';

describe('skills', () => {
  it('marks OpenCode and filesystem skills by sync state when discovery succeeds', () => {
    const merged = mergeDiscoveredSkills(
      [
        { name: 'skill-a', path: '/opencode/skill-a/SKILL.md', source: 'opencode' },
        { name: 'skill-b', path: '/opencode/skill-b/SKILL.md', source: 'opencode' },
      ],
      [
        { name: 'skill-a', path: '/filesystem/skill-a/SKILL.md', source: 'agents' },
        { name: 'skill-b', path: '/filesystem/skill-b/SKILL.md', source: 'agents' },
        { name: 'skill-c', path: '/filesystem/skill-c/SKILL.md', source: 'agents' },
      ],
    );

    expect(merged).toEqual([
      { name: 'skill-a', path: '/opencode/skill-a/SKILL.md', source: 'opencode', opencodeSynced: true },
      { name: 'skill-b', path: '/opencode/skill-b/SKILL.md', source: 'opencode', opencodeSynced: true },
      { name: 'skill-c', path: '/filesystem/skill-c/SKILL.md', source: 'agents', opencodeSynced: false },
    ]);
  });

  it('marks filesystem-only skills unsynced when OpenCode reports zero skills', () => {
    const merged = mergeDiscoveredSkills(
      [],
      [{ name: 'skill-x', path: '/filesystem/skill-x/SKILL.md', source: 'agents' }],
    );

    expect(merged).toEqual([
      { name: 'skill-x', path: '/filesystem/skill-x/SKILL.md', source: 'agents', opencodeSynced: false },
    ]);
  });

  it('leaves filesystem skill sync state unknown when OpenCode discovery fails', () => {
    const merged = mergeDiscoveredSkills(
      null,
      [{ name: 'skill-y', path: '/filesystem/skill-y/SKILL.md', source: 'agents' }],
    );

    expect(merged).toEqual([
      { name: 'skill-y', path: '/filesystem/skill-y/SKILL.md', source: 'agents' },
    ]);
    expect(merged[0]).not.toHaveProperty('opencodeSynced');
  });

  it('keeps the OpenCode skill when a filesystem skill has the same name', () => {
    const merged = mergeDiscoveredSkills(
      [{ name: 'skill-a', path: '/opencode/skill-a/SKILL.md', source: 'opencode' }],
      [{ name: 'skill-a', path: '/filesystem/skill-a/SKILL.md', source: 'agents' }],
    );

    expect(merged).toEqual([
      { name: 'skill-a', path: '/opencode/skill-a/SKILL.md', source: 'opencode', opencodeSynced: true },
    ]);
  });

  it('marks OpenCode-only skills synced when filesystem discovery is empty', () => {
    const merged = mergeDiscoveredSkills(
      [{ name: 'skill-a', path: '/opencode/skill-a/SKILL.md', source: 'opencode' }],
      [],
    );

    expect(merged).toEqual([
      { name: 'skill-a', path: '/opencode/skill-a/SKILL.md', source: 'opencode', opencodeSynced: true },
    ]);
  });

  it('resolves built-in OpenCode skill content without parsing virtual locations as files', () => {
    const sources = getSkillSources(
      'customize-opencode',
      '/tmp/openchamber-skills-test-missing-project',
      {
        name: 'customize-opencode',
        path: '<built-in>',
        scope: 'user',
        source: 'opencode',
        description: 'Customize opencode',
        content: '# Customizing opencode\n\nUse this skill when updating config.',
      },
    );

    expect(sources.md.exists).toBe(true);
    expect(sources.md.path).toBe(null);
    expect(sources.md.dir).toBe(null);
    expect(sources.md.scope).toBe('user');
    expect(sources.md.source).toBe('opencode');
    expect(sources.md.description).toBe('Customize opencode');
    expect(sources.md.instructions).toBe('# Customizing opencode\n\nUse this skill when updating config.');
    expect(sources.md.fields).toEqual(['description', 'instructions']);
  });

  it('clears file metadata when a discovered skill path is unreadable', () => {
    const missingPath = path.join(os.tmpdir(), 'openchamber-skills-test-missing-file', 'SKILL.md');
    const sources = getSkillSources(
      'missing-agent-skill',
      '/tmp/openchamber-skills-test-missing-project',
      {
        name: 'missing-agent-skill',
        path: missingPath,
        scope: 'user',
        source: 'agents',
        description: 'Missing skill',
      },
    );

    expect(sources.md.exists).toBe(false);
    expect(sources.md.path).toBe(null);
    expect(sources.md.dir).toBe(null);
    expect(sources.md.scope).toBe(null);
    expect(sources.md.source).toBe(null);
    expect(sources.md.description).toBe('Missing skill');
    expect(sources.md.instructions).toBe('');
  });

  it('enriches discovered skills when their location is a real markdown file', async () => {
    const tempRoot = await fsPromises.mkdtemp(path.join(os.tmpdir(), 'oc-skills-'));
    const skillDir = path.join(tempRoot, 'example-skill');
    const skillPath = path.join(skillDir, 'SKILL.md');

    try {
      await fsPromises.mkdir(skillDir, { recursive: true });
      await fsPromises.writeFile(
        skillPath,
        [
          '---',
          'name: example-skill',
          'description: Example from agents',
          '---',
          '',
          'Use this skill for examples.',
          '',
        ].join('\n'),
        'utf8',
      );

      const sources = getSkillSources('example-skill', tempRoot, {
        name: 'example-skill',
        path: skillPath,
        scope: 'user',
        source: 'agents',
        description: 'Fallback description',
      });

      expect(sources.md.exists).toBe(true);
      expect(sources.md.path).toBe(skillPath);
      expect(sources.md.scope).toBe('user');
      expect(sources.md.source).toBe('agents');
      expect(sources.md.description).toBe('Example from agents');
      expect(sources.md.instructions).toBe('Use this skill for examples.');
    } finally {
      await fsPromises.rm(tempRoot, { recursive: true, force: true });
    }
  });
});
