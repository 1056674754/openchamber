import { describe, expect, test } from 'bun:test';

import {
  getOpencodeDirectory,
  registerOpencodeDirectorySetter,
  setOpencodeDirectory,
} from './directoryBridge';

describe('opencode directory bridge', () => {
  test('replays the pending directory and keeps later writes synchronous', () => {
    const received: string[] = [];
    setOpencodeDirectory('/workspace/pending');

    const unregister = registerOpencodeDirectorySetter((directory) => {
      received.push(directory);
    });
    setOpencodeDirectory('/workspace/live');
    expect(getOpencodeDirectory()).toBe('/workspace/live');
    unregister();
    setOpencodeDirectory('/workspace/after-unregister');

    expect(received).toEqual(['/workspace/pending', '/workspace/live']);
  });
});
