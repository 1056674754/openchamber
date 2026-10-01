import { describe, expect, test } from 'bun:test';
import {
  PROTOCOL_V2_MINIMUM_VERSION,
  compareOpenCodeReleases,
  meetsProtocolV2Minimum,
  readExternalOpenCodeVersion,
  readOpenCodeCliVersion,
  readOpenCodeInfo,
  resolveProtocolModeFromVersion,
  supportsProtocolV2Track,
} from './compatibility.js';

const cli = (output, code = 0) => ({
  binary: process.execPath,
  args: ['-e', `console.log(${JSON.stringify(output)}); process.exit(${code})`, '--'],
});

describe('OpenCode compatibility (fork dual-stack probe)', () => {
  test('parses CLI version output including fork and prerelease suffixes', async () => {
    expect(await readOpenCodeCliVersion(cli('1.18.32'))).toBe('1.18.32');
    expect(await readOpenCodeCliVersion(cli('opencode v2.0.20'))).toBe('2.0.20');
    expect(await readOpenCodeCliVersion(cli('2.0.14-sscity'))).toBe('2.0.14-sscity');
    expect(await readOpenCodeCliVersion(cli('2.0.20-beta.1\n'))).toBe('2.0.20-beta.1');
    await expect(readOpenCodeCliVersion(cli('2.0.14-sscity', 1))).rejects.toThrow();
    await expect(readOpenCodeCliVersion(cli('error, requires 2.0.19'))).rejects.toThrow();
    await expect(readOpenCodeCliVersion(cli('not-a-version'))).rejects.toThrow();
  });

  test('does not accept HTTP 200 HTML or malformed JSON as readiness', async () => {
    expect(await readOpenCodeInfo(new Response('<html>OpenCode</html>'))).toBeNull();
    expect(await readOpenCodeInfo(Response.json({ healthy: true }))).toBeNull();
    expect(await readOpenCodeInfo(Response.json({ version: 'not a version' }))).toBeNull();
    expect(await readOpenCodeInfo(new Response('{}', { status: 500 }))).toBeNull();
    expect(await readOpenCodeInfo(Response.json({ version: '2.0.19' }))).toEqual({ version: '2.0.19' });
    expect(await readOpenCodeInfo(Response.json({ version: '2.0.14-sscity' }))).toEqual({ version: '2.0.14-sscity' });
  });

  test('identifies external v1 through its legacy health contract', async () => {
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(url.pathname);
      return url.pathname === '/api/info' ? new Response('<html/>') : Response.json({ healthy: true, version: '1.18.32' });
    };
    expect(await readExternalOpenCodeVersion('http://localhost:4096', {}, fetchImpl)).toBe('1.18.32');
    expect(requests).toEqual(['/api/info', '/global/health']);
  });

  test('identifies external v2 from /api/info without a legacy call', async () => {
    const requests = [];
    const fetchImpl = async (url) => {
      requests.push(url.pathname);
      return Response.json({ version: '2.0.14-sscity' });
    };
    expect(await readExternalOpenCodeVersion('http://localhost:4096', {}, fetchImpl)).toBe('2.0.14-sscity');
    expect(requests).toEqual(['/api/info']);
  });

  test('still identifies v1 when its /api/info fallback hangs or fails', async () => {
    const fetchImpl = async (url) => {
      if (url.pathname === '/api/info') throw new DOMException('The operation timed out.', 'TimeoutError');
      return Response.json({ healthy: true, version: '1.18.32' });
    };
    expect(await readExternalOpenCodeVersion('http://localhost:4096', {}, fetchImpl)).toBe('1.18.32');
  });

  test('does not treat a failed legacy probe as v1 either', async () => {
    const fetchImpl = async (url) => {
      if (url.pathname === '/api/info') throw new Error('ECONNREFUSED');
      return new Response('nope', { status: 502 });
    };
    expect(await readExternalOpenCodeVersion('http://localhost:4096', {}, fetchImpl)).toBeNull();
  });

  test.each([401, 403])('does not call an auth failure v1 (%s)', async (status) => {
    let requests = 0;
    expect(await readExternalOpenCodeVersion('http://localhost:4096', {}, async () => {
      requests += 1;
      return new Response(null, { status });
    })).toBeNull();
    expect(requests).toBe(1);
  });

  test('legacy probe only certifies 1.x versions', async () => {
    const fetchImpl = (version) => async (url) => (
      url.pathname === '/api/info' ? new Response('<html/>') : Response.json({ healthy: true, version })
    );
    expect(await readExternalOpenCodeVersion('http://localhost:4096', {}, fetchImpl('2.0.3'))).toBeNull();
    expect(await readExternalOpenCodeVersion('http://localhost:4096', {}, fetchImpl('garbage'))).toBeNull();
  });

  test('judges protocol mode from the major version with a conservative v1 default', () => {
    for (const version of ['2.0.3', '2.0.14', '2.0.14-sscity', '2.0.20-beta.1', '2.99.0']) {
      expect(resolveProtocolModeFromVersion(version)).toBe('v2');
    }
    for (const version of ['1.18.31', '1.18.31-sscity', '1.99.99', '3.0.0']) {
      expect(resolveProtocolModeFromVersion(version)).toBe('v1');
    }
    for (const version of [null, undefined, '', 'garbage', 'v2.0.14']) {
      expect(resolveProtocolModeFromVersion(version)).toBe('v1');
    }
  });

  test('v2-track capability requires v2 mode and the protocol floor', () => {
    expect(PROTOCOL_V2_MINIMUM_VERSION).toBe('2.0.14');
    expect(supportsProtocolV2Track('2.0.14')).toBe(true);
    expect(supportsProtocolV2Track('2.0.14-sscity')).toBe(true);
    expect(supportsProtocolV2Track('2.0.21')).toBe(true);
    expect(supportsProtocolV2Track('2.0.13')).toBe(false);
    expect(supportsProtocolV2Track('1.18.32')).toBe(false);
    expect(supportsProtocolV2Track('3.0.0')).toBe(false);
    expect(supportsProtocolV2Track(null)).toBe(false);
    expect(meetsProtocolV2Minimum('2.0.14')).toBe(true);
    expect(meetsProtocolV2Minimum('2.0.13')).toBe(false);
  });

  test('compares releases numerically with suffix stripping', () => {
    expect(compareOpenCodeReleases('2.0.9', '2.0.14')).toBeLessThan(0);
    expect(compareOpenCodeReleases('2.0.14-sscity', '2.0.14')).toBe(0);
    expect(compareOpenCodeReleases('1.18.31-sscity', '2.0.0')).toBeLessThan(0);
    expect(compareOpenCodeReleases('2.1.0', '2.0.20')).toBeGreaterThan(0);
  });
});
