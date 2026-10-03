import { afterEach, describe, expect, it } from 'vitest';

import {
  resolveUpstreamRequestPath,
  resolveUpstreamRequestPathForDefaultServer,
  rewriteDirectoryQueryForDefaultServer,
  rewriteDirectoryQueryForUpstream,
} from './upstream-v2-paths.js';
import { recordProtocolMode, resetProtocolModes } from './protocol-mode.js';

afterEach(() => {
  resetProtocolModes();
});

describe('v1 → v2 upstream request-path mapping', () => {
  it('keeps v1 paths byte-stable on the v1 track', () => {
    expect(resolveUpstreamRequestPath('/session', 'v1')).toBe('/session');
    expect(resolveUpstreamRequestPath('/global/event', 'v1')).toBe('/global/event');
    expect(resolveUpstreamRequestPath('/session/status?directory=/tmp', 'v1')).toBe('/session/status?directory=/tmp');
  });

  it('prefixes v1 paths with /api on the v2 track', () => {
    expect(resolveUpstreamRequestPath('/session', 'v2')).toBe('/api/session');
    expect(resolveUpstreamRequestPath('/session/abc/message?limit=5', 'v2')).toBe('/api/session/abc/message?limit=5');
    expect(resolveUpstreamRequestPath('/agent', 'v2')).toBe('/api/agent');
  });

  it('leaves already-v2 paths, the empty path, and the origin root untouched', () => {
    expect(resolveUpstreamRequestPath('/api/event', 'v2')).toBe('/api/event');
    expect(resolveUpstreamRequestPath('/api/info', 'v2')).toBe('/api/info');
    expect(resolveUpstreamRequestPath('/', 'v2')).toBe('/');
    expect(resolveUpstreamRequestPath('', 'v2')).toBe('');
  });

  it('renames the v1 names OpenCode 2 moved or folded', () => {
    expect(resolveUpstreamRequestPath('/global/event', 'v2')).toBe('/api/event');
    expect(resolveUpstreamRequestPath('/event', 'v2')).toBe('/api/event');
    expect(resolveUpstreamRequestPath('/path', 'v2')).toBe('/api/location');
    expect(resolveUpstreamRequestPath('/path?directory=/tmp', 'v2')).toBe('/api/location?directory=/tmp');
    expect(resolveUpstreamRequestPath('/session/status', 'v2')).toBe('/api/session/active');
  });

  it('does not rename v1 names that merely share a prefix', () => {
    expect(resolveUpstreamRequestPath('/session/statused', 'v2')).toBe('/api/session/statused');
    expect(resolveUpstreamRequestPath('/pathology', 'v2')).toBe('/api/pathology');
  });

  it('resolves against the default instance when no mode is passed', () => {
    expect(resolveUpstreamRequestPathForDefaultServer('/session')).toBe('/session');
    recordProtocolMode('default', { mode: 'v2' });
    expect(resolveUpstreamRequestPathForDefaultServer('/session')).toBe('/api/session');
  });
});

describe('v1 → v2 directory query rewrite', () => {
  it('ignores requests without a directory on any track', () => {
    expect(rewriteDirectoryQueryForUpstream('/session', 'v2')).toBe('/session');
    expect(rewriteDirectoryQueryForUpstream('/session?limit=5', 'v2')).toBe('/session?limit=5');
    expect(rewriteDirectoryQueryForUpstream('/session?directory=/tmp', 'v1')).toBe('/session?directory=/tmp');
  });

  it('moves ?directory= to the v2 location query', () => {
    const rewritten = rewriteDirectoryQueryForUpstream('/session?directory=/Users/test/My Dir&limit=5', 'v2');
    const params = new URLSearchParams(rewritten.split('?')[1] ?? '');
    expect(rewritten.split('?')[0]).toBe('/session');
    expect(params.get('location[directory]')).toBe('/Users/test/My Dir');
    expect(params.get('directory')).toBeNull();
    expect(params.get('limit')).toBe('5');
  });

  it('drops ?directory= when an explicit v2 location query is present', () => {
    const rewritten = rewriteDirectoryQueryForUpstream(
      '/config?directory=/a&location%5Bdirectory%5D=/b',
      'v2',
    );
    const params = new URLSearchParams(rewritten.split('?')[1] ?? '');
    expect(params.get('location[directory]')).toBe('/b');
    expect(params.get('directory')).toBeNull();
  });

  it('resolves against the default instance when no mode is passed', () => {
    expect(rewriteDirectoryQueryForDefaultServer('/session?directory=/tmp')).toBe('/session?directory=/tmp');
    recordProtocolMode('default', { mode: 'v2' });
    const rewritten = rewriteDirectoryQueryForDefaultServer('/session?directory=/tmp');
    expect(new URLSearchParams(rewritten.split('?')[1]).get('location[directory]')).toBe('/tmp');
  });
});
