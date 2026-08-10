import { invokeDesktop, isDesktopShell, isVSCodeRuntime } from '@/lib/desktop';
import { applyPendingRestart } from '@/lib/opencode/pendingRestart';
import { getActiveRelayTunnel, getRuntimeApiBaseUrl, getRuntimeKey } from '@/lib/runtime-switch';
import { runtimeFetch } from '@/lib/runtime-fetch';
import { openExternalUrl } from '@/lib/url';
import { useMcpConfigStore } from '@/stores/useMcpConfigStore';
import { useMcpStore } from '@/stores/useMcpStore';
import { MCP_OAUTH_CALLBACK_PATH, parseMcpOAuthCallbackStateKey } from './mcpOAuth';

type McpAuthorizationStart = {
  readonly authorizationUrl: string;
  readonly opened: boolean;
  readonly nativeFlow?: boolean;
  readonly completion?: Promise<void>;
};

class McpAuthorizationError extends Error {}

const MCP_OAUTH_ORIGIN_DESKTOP = 'desktop';
const AUTHORIZATION_WATCH_MS = 3 * 60_000;
const AUTHORIZATION_POLL_MS = 1_500;

export const buildMcpAuthorizationRedirectUri = (name: string): string => {
  if (typeof window === 'undefined') {
    throw new McpAuthorizationError('No browser context to build a callback URL from');
  }
  const callbackBaseUrl = getActiveRelayTunnel()
    ? window.location.origin
    : getRuntimeApiBaseUrl() || window.location.origin;
  const url = new URL(MCP_OAUTH_CALLBACK_PATH, callbackBaseUrl);
  url.searchParams.set('server', name);
  return url.toString();
};

const isRecord = (value: unknown): value is Record<string, unknown> => (
  typeof value === 'object' && value !== null && !Array.isArray(value)
);

const readPendingPayload = async (response: Response): Promise<Record<string, unknown> | null> => {
  const payload: unknown = await response.json().catch(() => null);
  return isRecord(payload) ? payload : null;
};

const queuePendingContext = async (input: {
  readonly state: string;
  readonly name: string;
  readonly directory?: string | null;
  readonly relayBridge: boolean;
}): Promise<void> => {
  const request = input.relayBridge ? fetch : runtimeFetch;
  const response = await request('/api/mcp/auth/pending', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      state: input.state,
      name: input.name,
      directory: input.directory?.trim() ? input.directory.trim() : null,
      origin: isDesktopShell() ? MCP_OAUTH_ORIGIN_DESKTOP : null,
      completionMode: input.relayBridge ? 'client' : 'server',
    }),
  });
  if (!response.ok) {
    const payload = await readPendingPayload(response);
    throw new McpAuthorizationError(
      typeof payload?.error === 'string' ? payload.error : 'Failed to prepare the MCP authorization callback',
    );
  }
};

const clearPendingContext = async (state: string | null, relayBridge: boolean): Promise<void> => {
  if (!state) return;
  const request = relayBridge ? fetch : runtimeFetch;
  await request(`/api/mcp/auth/pending?state=${encodeURIComponent(state)}`, { method: 'DELETE' })
    .catch(() => undefined);
};

const applyDeferredAuthorizationConfig = async (): Promise<void> => {
  const applied = await applyPendingRestart(getRuntimeApiBaseUrl());
  if (applied.requiresManualRestart) {
    throw new McpAuthorizationError(
      'The callback settings changed, but OpenCode must be restarted manually before authorization can start.',
    );
  }
  if (!applied.success) {
    throw new McpAuthorizationError(
      'Failed to apply the callback settings. Use Apply & Restart, then authorize again.',
    );
  }
};

const clearCustomRedirectUriForNativeFlow = async (name: string): Promise<void> => {
  if (!useMcpConfigStore.getState().getMcpByName(name)) {
    await useMcpConfigStore.getState().loadMcpConfigs();
  }
  const configStore = useMcpConfigStore.getState();
  const existing = configStore.getMcpByName(name);
  const currentOAuth = existing && 'oauth' in existing && existing.oauth ? existing.oauth : null;
  if (!existing || !currentOAuth?.redirectUri) return;

  const saved = await configStore.updateMcp(name, {
    oauthEnabled: true,
    oauthClientId: currentOAuth.clientId ?? '',
    oauthClientSecret: currentOAuth.clientSecret ?? '',
    oauthScope: currentOAuth.scope ?? '',
    oauthRedirectUri: '',
  });
  if (!saved.ok) {
    throw new McpAuthorizationError(saved.message || 'Failed to reset the authorization callback URL');
  }
  if (saved.restartDeferred) await applyDeferredAuthorizationConfig();
};

const focusDesktopWindow = async (): Promise<void> => {
  if (!isDesktopShell()) return;
  await invokeDesktop('desktop_focus_main_window').catch(() => undefined);
};

const waitForRelayCallback = async (
  state: string,
  name: string,
  directory: string | null,
): Promise<void> => {
  const deadline = Date.now() + AUTHORIZATION_WATCH_MS;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, AUTHORIZATION_POLL_MS));
    const response = await fetch(`/api/mcp/auth/pending?state=${encodeURIComponent(state)}`);
    if (!response.ok) continue;
    const payload = await readPendingPayload(response);
    const callbackError = typeof payload?.error === 'string' ? payload.error : null;
    if (callbackError) throw new McpAuthorizationError(callbackError);
    const code = typeof payload?.code === 'string' ? payload.code : null;
    if (!code) continue;
    await useMcpStore.getState().completeAuth(name, code, directory);
    await clearPendingContext(state, true);
    await focusDesktopWindow();
    return;
  }
  throw new McpAuthorizationError('Authorization timed out. Start authorization again from MCP Settings.');
};

export const startMcpAuthorization = async (input: {
  readonly name: string;
  readonly directory?: string | null;
}): Promise<McpAuthorizationStart> => {
  const { name, directory } = input;
  const relayBridge = getActiveRelayTunnel() !== null;
  let queuedState: string | null = null;

  if (!relayBridge && (isVSCodeRuntime() || (isDesktopShell() && getRuntimeKey() === 'local'))) {
    await clearCustomRedirectUriForNativeFlow(name);
    const completion = useMcpStore.getState().authenticate(name, directory ?? null);
    void completion.then(focusDesktopWindow).catch(() => undefined);
    return { authorizationUrl: '', opened: true, nativeFlow: true, completion };
  }

  try {
    if (!useMcpConfigStore.getState().getMcpByName(name)) {
      await useMcpConfigStore.getState().loadMcpConfigs();
    }
    const configStore = useMcpConfigStore.getState();
    const existing = configStore.getMcpByName(name);
    const currentOAuth = existing && 'oauth' in existing && existing.oauth ? existing.oauth : null;
    const desiredRedirectUri = buildMcpAuthorizationRedirectUri(name);
    if (existing && currentOAuth?.redirectUri !== desiredRedirectUri) {
      const saved = await configStore.updateMcp(name, {
        oauthEnabled: true,
        oauthClientId: currentOAuth?.clientId ?? '',
        oauthClientSecret: currentOAuth?.clientSecret ?? '',
        oauthScope: currentOAuth?.scope ?? '',
        oauthRedirectUri: desiredRedirectUri,
      });
      if (!saved.ok) {
        throw new McpAuthorizationError(saved.message || 'Failed to save the authorization callback URL');
      }
      if (saved.restartDeferred) await applyDeferredAuthorizationConfig();
    }

    const authorizationUrl = await useMcpStore.getState().startAuth(name, directory ?? null);
    const state = parseMcpOAuthCallbackStateKey(new URL(authorizationUrl).searchParams);
    if (state) {
      queuedState = state;
      await queuePendingContext({ state, name, directory, relayBridge });
    }
    const opened = await openExternalUrl(authorizationUrl);
    const completion = relayBridge && state
      ? waitForRelayCallback(state, name, directory ?? null)
      : undefined;
    return { authorizationUrl, opened, ...(completion ? { completion } : {}) };
  } catch (error) {
    await clearPendingContext(queuedState, relayBridge);
    throw error;
  }
};
