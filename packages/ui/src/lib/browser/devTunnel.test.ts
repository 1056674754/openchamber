import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test';

let tunnelResult: unknown = { localPort: 52418, reused: false };
let invokeCalls: Array<{ command: string; args: unknown }> = [];
const invoke = mock(async (command: string, args: unknown) => {
  invokeCalls.push({ command, args });
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
    invokeCalls = [];
    asDesktop(true);
  });

  afterEach(() => {
    delete globalScope.window;
  });

  test('rewrites remote loopback through an authority-resolved shell tunnel', async () => {
    const tunneled = await resolveBrowsableUrl('http://localhost:3010/docs?q=1', 'dev3');
    expect(tunneled).toBe('http://127.0.0.1:52418/docs?q=1');
    expect(invokeCalls).toEqual([{
      command: 'desktop_dev_tunnel_open',
      args: { serverId: 'dev3', port: 3010 },
    }]);
    expect(toDisplayUrl(tunneled)).toBe('http://localhost:3010/docs?q=1');
  });

  test('reuses a tunnel per instance and port', async () => {
    await resolveBrowsableUrl('http://localhost:3000/', 'dev3');
    await resolveBrowsableUrl('http://127.0.0.1:3000/next', 'dev3');
    expect(invokeCalls.length).toBe(1);
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
    expect(invokeCalls).toEqual([{
      command: 'desktop_dev_tunnel_open',
      args: { serverId: 'dev2', port: 443 },
    }]);
  });

  test('fails closed instead of loading this machine loopback', async () => {
    tunnelResult = new Error('remote unavailable');
    let error: unknown = null;
    try {
      await resolveBrowsableUrl('http://localhost:3100/', 'dev3');
    } catch (caught) {
      error = caught;
    }
    expect(error instanceof DevTunnelUnavailableError).toBe(true);
  });
});
