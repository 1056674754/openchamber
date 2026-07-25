import { describe, expect, it } from 'bun:test';
import {
  buildRemoteUpstreamHeaders,
  preserveRemoteRequestHeaderValues,
  redactRemoteRequestHeadersForApi,
  sanitizeRemoteRequestHeaders,
} from './request-headers.js';

describe('sanitizeRemoteRequestHeaders', () => {
  it('keeps valid headers and drops Authorization / CRLF / empties', () => {
    expect(sanitizeRemoteRequestHeaders({
      'CF-Access-Client-Id': ' id-a ',
      Authorization: 'Bearer leaked',
      'Bad\nName': 'x',
      'Bad-Value': 'y\r\n',
      '': 'nope',
      Empty: '  ',
    })).toEqual({
      'CF-Access-Client-Id': 'id-a',
    });
  });
});

describe('buildRemoteUpstreamHeaders', () => {
  it('merges custom headers with bearer auth (auth wins)', () => {
    expect(buildRemoteUpstreamHeaders({
      auth: { type: 'bearer', value: 'secret' },
      requestHeaders: {
        'CF-Access-Client-Id': 'id-a',
        Authorization: 'should-drop',
      },
    })).toEqual({
      'CF-Access-Client-Id': 'id-a',
      Authorization: 'Bearer secret',
    });
  });

  it('isolates headers per instance object', () => {
    const a = buildRemoteUpstreamHeaders({
      id: 'a',
      auth: { type: 'bearer', value: 'token-a' },
      requestHeaders: { 'X-Instance': 'a' },
    });
    const b = buildRemoteUpstreamHeaders({
      id: 'b',
      auth: { type: 'bearer', value: 'token-b' },
      requestHeaders: { 'X-Instance': 'b' },
    });
    expect(a['X-Instance']).toBe('a');
    expect(b['X-Instance']).toBe('b');
    expect(a.Authorization).toBe('Bearer token-a');
    expect(b.Authorization).toBe('Bearer token-b');
  });
});

describe('redact + preserve request headers', () => {
  it('redacts values but keeps names', () => {
    expect(redactRemoteRequestHeadersForApi({
      'CF-Access-Client-Secret': 'super-secret',
      'CF-Access-Client-Id': 'id-a',
    })).toEqual({
      requestHeaders: {
        'CF-Access-Client-Secret': '',
        'CF-Access-Client-Id': '',
      },
      hasRequestHeaders: true,
    });
  });

  it('preserves secrets when client sends empty values for known names', () => {
    expect(preserveRemoteRequestHeaderValues(
      { 'CF-Access-Client-Secret': 'super-secret', Keep: '1' },
      { 'CF-Access-Client-Secret': '', Keep: '1', Added: '2' },
    )).toEqual({
      'CF-Access-Client-Secret': 'super-secret',
      Keep: '1',
      Added: '2',
    });
  });

  it('drops names omitted from the next map', () => {
    expect(preserveRemoteRequestHeaderValues(
      { Keep: '1', Drop: 'gone' },
      { Keep: '' },
    )).toEqual({ Keep: '1' });
  });
});
