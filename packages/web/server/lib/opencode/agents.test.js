import { afterEach, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { updateAgent } from './agents.js';
import { parseMdFile, writeMdFile } from './shared.js';

const tempRoots = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe('agent updates', () => {
  test('preserves existing frontmatter when an update field is undefined', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-agent-frontmatter-'));
    tempRoots.push(root);
    const agentPath = path.join(root, '.opencode', 'agents', 'build.md');
    fs.mkdirSync(path.dirname(agentPath), { recursive: true });

    writeMdFile(agentPath, {
      description: 'Existing description',
      mode: 'subagent',
      custom_field: 'keep-me',
    }, 'Existing prompt');

    updateAgent('build', {
      description: undefined,
      mode: 'primary',
    }, root);

    const stored = parseMdFile(agentPath);
    expect(stored.frontmatter).toEqual({
      description: 'Existing description',
      mode: 'primary',
      custom_field: 'keep-me',
    });
    expect(stored.body.trim()).toBe('Existing prompt');
  });
});
