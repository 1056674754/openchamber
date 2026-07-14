import { afterAll, afterEach, beforeAll, describe, expect, test } from 'bun:test';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createOpenCodeGoCredentialStore } from './opencode-go-credentials.js';

let dataDir;
let store;

beforeAll(() => {
  dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-go-'));
  store = createOpenCodeGoCredentialStore({ dataDir });
});

afterEach(() => store.remove());

afterAll(() => {
  fs.rmSync(dataDir, { recursive: true, force: true });
});

describe('OpenCode Go credential store', () => {
  test('normalizes, masks, and stores credentials with owner-only permissions', () => {
    const status = store.write({ workspaceId: ' wrk_test ', authCookie: ' auth=secret ' });

    expect(status).toEqual({
      configured: true,
      workspaceId: 'wrk_test',
      secretMasked: '********',
    });
    expect(store.read()).toEqual({ workspaceId: 'wrk_test', authCookie: 'secret' });
    expect(fs.statSync(path.join(dataDir, 'quota', 'opencode-go.json')).mode & 0o777).toBe(0o600);
  });

  test('removes credentials without exposing prior values', () => {
    store.write({ workspaceId: 'wrk_test', authCookie: 'secret' });
    store.remove();
    expect(store.getStatus()).toEqual({ configured: false });
  });
});
