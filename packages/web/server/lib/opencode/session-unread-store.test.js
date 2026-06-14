import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createSessionUnreadStore } from './session-unread-store.js';

const makeStore = () => {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-unread-'));
  const changes = [];
  const store = createSessionUnreadStore({
    fs,
    path,
    dataDir,
    onChange: (change) => {
      changes.push(change);
    },
  });
  return { dataDir, store, changes };
};

describe('session unread store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('persists manual unread state across reloads', () => {
    vi.spyOn(Date, 'now').mockReturnValue(1_780_358_400_000);
    const { dataDir, store, changes } = makeStore();
    store.load();

    const state = store.markUnread('session-1');
    store.flush();

    const reloaded = createSessionUnreadStore({ fs, path, dataDir });
    reloaded.load();

    expect(state).toEqual({ unread: true, hasError: false });
    expect(reloaded.getUnreadState('session-1')).toEqual({ unread: true, hasError: false });
    expect(reloaded.getTotalUnread()).toBe(1);
    expect(changes.at(-1)).toEqual(expect.objectContaining({
      sessionId: 'session-1',
      state: { unread: true, hasError: false },
      totalUnread: 1,
    }));
  });

  it('marks a manual unread session read without losing the persisted entry', () => {
    const dateNow = vi.spyOn(Date, 'now').mockReturnValue(1_780_358_400_000);
    const { store } = makeStore();
    store.load();
    store.markUnread('session-1');

    dateNow.mockReturnValue(1_780_358_401_000);
    const state = store.markRead('session-1');

    expect(state).toEqual({ unread: false, hasError: false });
    expect(store.getUnreadState('session-1')).toEqual({ unread: false, hasError: false });
    expect(store.getTotalUnread()).toBe(0);
  });

  it('loads the previous unread file shape', () => {
    const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'openchamber-unread-legacy-'));
    fs.writeFileSync(
      path.join(dataDir, 'session-unread.json'),
      JSON.stringify({
        sessions: {
          'legacy-session': {
            lastActivityAt: Date.now(),
            lastReadAt: 0,
            hasError: true,
          },
        },
      }),
      'utf8',
    );

    const store = createSessionUnreadStore({ fs, path, dataDir });
    store.load();

    expect(store.getUnreadState('legacy-session')).toEqual({ unread: true, hasError: true });
  });
});
