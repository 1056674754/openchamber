import { describe, expect, it } from 'vitest';

import {
  applyForwardProxyResponseHeaders,
  collectForwardProxyHeaders,
  preserveDecodedPayloadLengthHeader,
  shouldForwardProxyResponseHeader,
} from './proxy-headers.js';

describe('OpenCode proxy header handling', () => {
  it('drops accept-encoding from forwarded request headers', () => {
    const headers = collectForwardProxyHeaders({
      accept: 'application/json',
      'accept-encoding': 'gzip, deflate, br',
      connection: 'keep-alive',
    });

    expect(headers.accept).toBe('application/json');
    expect(headers['accept-encoding']).toBeUndefined();
  });

  it('drops content-encoding from forwarded response headers', () => {
    expect(shouldForwardProxyResponseHeader('content-encoding')).toBe(false);
    expect(shouldForwardProxyResponseHeader('Content-Encoding')).toBe(false);
  });

  it('drops transfer-encoding from forwarded response headers', () => {
    expect(shouldForwardProxyResponseHeader('transfer-encoding')).toBe(false);
    expect(shouldForwardProxyResponseHeader('Transfer-Encoding')).toBe(false);
  });

  it('still keeps ordinary response headers', () => {
    expect(shouldForwardProxyResponseHeader('content-type')).toBe(true);
    expect(shouldForwardProxyResponseHeader('etag')).toBe(true);
  });

  it('preserves an identity response length under the decoded-payload header', () => {
    const headers = {
      'content-length': '7345',
      'content-type': 'application/json',
    };

    preserveDecodedPayloadLengthHeader(headers);

    expect(headers['x-openchamber-decoded-content-length']).toBe('7345');
  });

  it('does not label a compressed response length as decoded bytes', () => {
    const headers = {
      'content-encoding': 'gzip',
      'content-length': '7345',
      'x-openchamber-decoded-content-length': '9999',
    };

    preserveDecodedPayloadLengthHeader(headers);

    expect(headers['x-openchamber-decoded-content-length']).toBeUndefined();
  });

  it('applies upstream response headers to express response without content-encoding', () => {
    const applied = [];
    const response = {
      setHeader(key, value) {
        applied.push([key, value]);
      },
    };

    applyForwardProxyResponseHeaders(
      new Headers({
        'content-type': 'application/json',
        etag: 'W/"abc"',
        'content-encoding': 'gzip',
      }),
      response,
    );

    expect(applied).toEqual([
      ['content-type', 'application/json'],
      ['etag', 'W/"abc"'],
    ]);
  });
});
