import fs from 'fs';
import os from 'os';
import path from 'path';
import { afterEach, describe, expect, it } from 'vitest';

import {
  createSessionMarkersStore,
  SessionMarkersPersistenceError,
} from './session-markers-store.js';

const tempDirs = [];

const createTempDir = () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-session-markers-'));
  tempDirs.push(dir);
  return dir;
};

afterEach(() => {
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop();
    fs.rmSync(dir, { force: true, recursive: true });
  }
});

describe('session markers store', () => {
  it('persists markers and reloads them from disk', () => {
    const dataDir = createTempDir();
    const store = createSessionMarkersStore({ fs, path, dataDir });

    store.load();
    store.applyPatch('ses_1', {
      status: 'in-progress',
      todos: ['uncommitted', 'untested'],
      important: true,
    });
    store.dispose();

    const reloaded = createSessionMarkersStore({ fs, path, dataDir });
    reloaded.load();

    expect(reloaded.getMarkers('ses_1')).toEqual({
      status: 'in-progress',
      todos: ['uncommitted', 'untested'],
      important: true,
    });
    reloaded.dispose();
  });

  it('throws and preserves memory when a marker write cannot be persisted', () => {
    const dataDir = createTempDir();
    const store = createSessionMarkersStore({ fs, path, dataDir });

    store.load();
    store.applyPatch('ses_1', { todos: ['uncommitted'] });
    store.dispose();
    fs.rmSync(dataDir, { force: true, recursive: true });
    fs.writeFileSync(dataDir, 'not a directory');

    expect(() => store.applyPatch('ses_1', { todos: ['untested'] })).toThrow(
      SessionMarkersPersistenceError,
    );
    expect(store.getMarkers('ses_1')).toEqual({ todos: ['uncommitted'] });
  });
});
