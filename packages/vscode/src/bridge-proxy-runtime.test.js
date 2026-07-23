import { describe, expect, test } from 'bun:test';

import { projectMessageHistoryResponseText, setDecodedPayloadLengthHeader } from './bridge-proxy-runtime.ts';

describe('VS Code proxy decoded payload length', () => {
  test('records the bytes measured after fetch decoding', () => {
    const headers = { 'content-type': 'application/json' };

    setDecodedPayloadLengthHeader(headers, 8192);

    expect(headers['x-openchamber-decoded-content-length']).toBe('8192');
  });

  test('removes an untrusted value when the measured size is invalid', () => {
    const headers = { 'x-openchamber-decoded-content-length': '9999' };

    setDecodedPayloadLengthHeader(headers, Number.NaN);

    expect(headers['x-openchamber-decoded-content-length']).toBeUndefined();
  });
});

describe('VS Code message history projection', () => {
  test('removes unused snapshots and caps patches', () => {
    const projected = JSON.parse(projectMessageHistoryResponseText(JSON.stringify([{
      info: {
        role: 'user',
        summary: {
          additions: 4,
          diffs: [{
            file: 'large.ts',
            before: 'b'.repeat(400_000),
            after: 'a'.repeat(400_000),
            patch: 'p'.repeat(120_000),
          }],
        },
      },
      parts: [],
    }])));

    expect(projected[0].info.summary.diffs[0].before).toBeUndefined();
    expect(projected[0].info.summary.diffs[0].after).toBeUndefined();
    expect(projected[0].info.summary.diffs[0].patch).toHaveLength(100_000);
    expect(projected[0].info.summary.additions).toBe(4);
  });
});
