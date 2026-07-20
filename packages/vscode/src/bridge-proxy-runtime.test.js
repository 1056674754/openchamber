import { describe, expect, test } from 'bun:test';

import { setDecodedPayloadLengthHeader } from './bridge-proxy-runtime.ts';

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
