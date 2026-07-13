import { describe, expect, it, vi } from 'vitest';

import { hasSameHttpOrigin, loginRemotePasswordAndPersistSession } from './remote-password-login.mjs';

describe('remote password login', () => {
  it('only treats matching HTTP origins as equivalent', () => {
    expect(hasSameHttpOrigin('https://example.test/chat', 'https://example.test/settings')).toBe(true);
    expect(hasSameHttpOrigin('https://example.test', 'https://other.test')).toBe(false);
    expect(hasSameHttpOrigin('file:///tmp/app.html', 'https://example.test')).toBe(false);
  });

  it('persists the returned HttpOnly session cookie', async () => {
    const set = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ authenticated: true }), {
      status: 200,
      headers: {
        'Set-Cookie': 'oc_ui_session=token-value; Path=/; HttpOnly; SameSite=Lax; Max-Age=3600',
      },
    }));

    await expect(loginRemotePasswordAndPersistSession({
      url: 'https://example.test/app',
      password: 'secret',
      trustDevice: true,
      cookieStore: { set },
      fetchImpl,
    })).resolves.toEqual({ ok: true, status: 200 });

    expect(fetchImpl).toHaveBeenCalledWith('https://example.test/auth/session', expect.objectContaining({ method: 'POST' }));
    expect(set).toHaveBeenCalledWith(expect.objectContaining({
      url: 'https://example.test',
      name: 'oc_ui_session',
      value: 'token-value',
      path: '/',
      httpOnly: true,
      sameSite: 'lax',
    }));
  });

  it('does not persist cookies after a rejected password', async () => {
    const set = vi.fn(async () => undefined);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 401 }));

    await expect(loginRemotePasswordAndPersistSession({
      url: 'https://example.test',
      password: 'wrong',
      trustDevice: false,
      cookieStore: { set },
      fetchImpl,
    })).resolves.toEqual({ ok: false, status: 401 });
    expect(set).not.toHaveBeenCalled();
  });
});
