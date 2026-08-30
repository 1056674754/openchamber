import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let tunnelResult: unknown = { localPort: 52418, reused: false };
const invoke = mock(async () => {
  if (tunnelResult instanceof Error) throw tunnelResult;
  return tunnelResult;
});

mock.module('@/lib/desktopNative', () => ({ invokeDesktopCommand: invoke }));
mock.module('@/lib/runtime-switch', () => ({ subscribeRuntimeEndpointChanged: () => () => {} }));

const {
  DevTunnelUnavailableError,
  resolveBrowsableUrl,
  shouldTunnelLoopbackUrl,
  toDisplayUrl,
} = await import('./devTunnel');

const globalScope = globalThis as unknown as { window?: unknown };
const asDesktop = (value: boolean) => {
  globalScope.window = value ? { __OPENCHAMBER_ELECTRON__: true } : {};
};

describe('instance-scoped remote dev tunnels', () => {
  beforeEach(() => {
    tunnelResult = { localPort: 52418, reused: false };
    invoke.mockClear();
    asDesktop(true);
  });

  afterEach(() => {
    delete globalScope.window;
  });

  test('rewrites remote loopback through an authority-resolved shell tunnel', async () => {
    const tunneled = await resolveBrowsableUrl('http://localhost:3010/docs?q=1', 'dev3');
    expect(tunneled).toBe('http://127.0.0.1:52418/docs?q=1');
    expect(invoke).toHaveBeenCalledWith('desktop_dev_tunnel_open', { serverId: 'dev3', port: 3010 });
    expect(toDisplayUrl(tunneled)).toBe('http://localhost:3010/docs?q=1');
  });

  test('reuses a tunnel per instance and port', async () => {
    await resolveBrowsableUrl('http://localhost:3000/', 'dev3');
    await resolveBrowsableUrl('http://127.0.0.1:3000/next', 'dev3');
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  test('keeps other loopback ports on the remote host', () => {
    expect(shouldTunnelLoopbackUrl('http://localhost:4322/docs/', 'dev3')).toBe(true);
    expect(shouldTunnelLoopbackUrl('http://127.0.0.1:52418/', 'dev3')).toBe(false);
  });

  test('does not tunnel local, public, or non-desktop targets', async () => {
    expect(await resolveBrowsableUrl('http://localhost:5173/', 'default')).toBe('http://localhost:5173/');
    expect(await resolveBrowsableUrl('https://openchamber.dev/', 'dev3')).toBe('https://openchamber.dev/');
    asDesktop(false);
    expect(await resolveBrowsableUrl('http://localhost:5173/', 'dev3')).toBe('http://localhost:5173/');
  });

  test('uses implicit protocol ports', async () => {
    await resolveBrowsableUrl('https://localhost/', 'dev2');
    expect(invoke).toHaveBeenCalledWith('desktop_dev_tunnel_open', { serverId: 'dev2', port: 443 });
  });

  test('fails closed instead of loading this machine loopback', async () => {
    tunnelResult = new Error('remote unavailable');
    await expect(resolveBrowsableUrl('http://localhost:3100/', 'dev3'))
      .rejects.toBeInstanceOf(DevTunnelUnavailableError);
  });
});
