import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';

import { readConfigFile, writeConfig } from './shared.js';

const PARTIAL_PARSE_CONFIG = [
  '{',
  '  "$schema": "https://opencode.ai/config.json",',
  '  plugin: ["opencode-see-image"],',
  '  mcp: { openproject: { type: "remote" } }',
  '}',
  '',
].join('\n');

describe('OpenCode JSONC config safety', () => {
  let tempDir;

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-config-parse-'));
  });

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
  });

  const writeFixture = (name, content) => {
    const filePath = path.join(tempDir, name);
    fs.writeFileSync(filePath, content, 'utf8');
    return filePath;
  };

  it('parses comments and trailing commas without dropping keys', () => {
    const file = writeFixture('valid.jsonc', [
      '{',
      '  // retained comment',
      '  "plugin": ["one"],',
      '  "provider": { "test": { "name": "Test" } },',
      '}',
    ].join('\n'));

    expect(readConfigFile(file)).toEqual({
      plugin: ['one'],
      provider: { test: { name: 'Test' } },
    });
  });

  it('treats comment-only content as an empty config', () => {
    const file = writeFixture('comments.jsonc', '// placeholder\n/* still empty */\n');
    expect(readConfigFile(file)).toEqual({});
  });

  it('rejects partial JSONC trees and non-object roots', () => {
    const partial = writeFixture('partial.jsonc', PARTIAL_PARSE_CONFIG);
    const array = writeFixture('array.jsonc', '["plugin"]\n');

    for (const file of [partial, array]) {
      try {
        readConfigFile(file);
        throw new Error('Expected invalid config to throw');
      } catch (error) {
        expect(error).toHaveProperty('code', 'INVALID_JSONC');
        expect(error.message).toContain('cannot be loaded safely');
      }
    }
  });

  it('does not create a backup or overwrite when the existing file is invalid', () => {
    const file = writeFixture('partial.jsonc', PARTIAL_PARSE_CONFIG);

    expect(() => writeConfig({ plugin: ['replacement'] }, file)).toThrow(/cannot be loaded safely/);
    expect(fs.readFileSync(file, 'utf8')).toBe(PARTIAL_PARSE_CONFIG);
    expect(fs.existsSync(`${file}.openchamber.backup`)).toBe(false);
  });
});
