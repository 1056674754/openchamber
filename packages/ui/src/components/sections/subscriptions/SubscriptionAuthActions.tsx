import React from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { resolveApiUrl } from '@/lib/api/serverUrl';
import { useSettingsServerBaseUrl } from '@/hooks/useSettingsServerBaseUrl';
import { copyTextToClipboard } from '@/lib/clipboard';
import { openExternalUrl } from '@/lib/url';
import type { SubscriptionProvider } from './useSubscriptions';
import {
  isOAuthPromptActive,
  parseOAuthPrompts,
  useSubscriptionAuthMethods,
  type OAuthPrompt,
  type SubscriptionOAuthMethod,
} from './useSubscriptionAuthMethods';

interface OAuthDetails {
  url?: string;
  instructions?: string;
  userCode?: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const readErrorMessage = (payload: unknown): string | null => {
  if (!isRecord(payload)) {
    return null;
  }
  if (typeof payload.error === 'string' && payload.error) {
    return payload.error;
  }
  if (isRecord(payload.data) && typeof payload.data.error === 'string' && payload.data.error) {
    return payload.data.error;
  }
  if (typeof payload.message === 'string' && payload.message) {
    return payload.message;
  }
  return null;
};

const sleep = (ms: number) => new Promise<void>((resolve) => {
  window.setTimeout(resolve, ms);
});

const mergePrompts = (base: OAuthPrompt[], extra: OAuthPrompt[] | undefined): OAuthPrompt[] => {
  if (!extra || extra.length === 0) {
    return base;
  }
  const seen = new Set(base.map((prompt) => prompt.key));
  const merged = [...base];
  for (const prompt of extra) {
    if (!seen.has(prompt.key)) {
      merged.push(prompt);
      seen.add(prompt.key);
    }
  }
  return merged;
};

interface SubscriptionAuthActionsProps {
  provider: SubscriptionProvider;
  /** Refetch subscription state after a successful mutation. */
  onChanged: () => Promise<void>;
}

/**
 * P2 operations for the Subscriptions detail card: set API key, disconnect,
 * and OAuth login. All requests go to the currently-selected settings
 * instance (resolveApiUrl + baseUrl), never a hardcoded server.
 */
export const SubscriptionAuthActions: React.FC<SubscriptionAuthActionsProps> = ({ provider, onChanged }) => {
  const { t } = useI18n();
  const { status, baseUrl } = useSettingsServerBaseUrl();
  const { oauthMethodsByProvider } = useSubscriptionAuthMethods();

  const [showApiKeyForm, setShowApiKeyForm] = React.useState(false);
  const [apiKey, setApiKey] = React.useState('');
  const [confirmDisconnect, setConfirmDisconnect] = React.useState(false);
  const [busyKey, setBusyKey] = React.useState<string | null>(null);
  const [oauthDetails, setOauthDetails] = React.useState<Record<string, OAuthDetails>>({});
  const [oauthCodes, setOauthCodes] = React.useState<Record<string, string>>({});
  const [oauthPending, setOauthPending] = React.useState<string | null>(null);
  const [oauthPromptAnswers, setOauthPromptAnswers] = React.useState<Record<string, Record<string, string>>>({});
  const [oauthExtraPrompts, setOauthExtraPrompts] = React.useState<Record<string, OAuthPrompt[]>>({});
  const [oauthErrors, setOauthErrors] = React.useState<Record<string, string>>({});

  const oauthMethods = oauthMethodsByProvider[provider.id] ?? [];

  // Reset transient state (and any retained secret) when the provider changes.
  React.useEffect(() => {
    setShowApiKeyForm(false);
    setApiKey('');
    setConfirmDisconnect(false);
    setBusyKey(null);
    setOauthDetails({});
    setOauthCodes({});
    setOauthPending(null);
    setOauthPromptAnswers({});
    setOauthExtraPrompts({});
    setOauthErrors({});
  }, [provider.id]);

  /** Explicit instance-aware config reload; required after PUT / OAuth callback. */
  const reloadInstanceConfig = React.useCallback(async () => {
    const response = await fetch(resolveApiUrl('/api/config/reload', baseUrl), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(readErrorMessage(payload) ?? t('settings.subscriptions.page.toast.configReloadFailed'));
    }
  }, [baseUrl, t]);

  const setOauthError = (methodKey: string, message: string | null) => {
    setOauthErrors((prev) => {
      const next = { ...prev };
      if (message) {
        next[methodKey] = message;
      } else {
        delete next[methodKey];
      }
      return next;
    });
  };

  const handleSaveApiKey = async () => {
    if (status !== 'ready') return;
    const key = apiKey.trim();
    if (!key) {
      toast.error(t('settings.subscriptions.page.toast.apiKeyRequired'));
      return;
    }

    setBusyKey('api');
    try {
      const response = await fetch(resolveApiUrl(`/api/auth/${encodeURIComponent(provider.id)}`, baseUrl), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type: 'api', key }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readErrorMessage(payload) ?? t('settings.subscriptions.page.toast.apiKeySaveFailed'));
      }

      // Secret handled: clear before any async continuation below.
      setApiKey('');
      setShowApiKeyForm(false);

      await reloadInstanceConfig();
      await onChanged();
      toast.success(t('settings.subscriptions.page.toast.apiKeySaved'));
    } catch (error) {
      console.error('Failed to save API key or reload provider configuration');
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('settings.subscriptions.page.toast.apiKeySaveFailed'),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleDisconnect = async () => {
    if (status !== 'ready') return;
    setBusyKey('disconnect');
    try {
      const response = await fetch(
        resolveApiUrl(`/api/provider/${encodeURIComponent(provider.id)}/auth?scope=all`, baseUrl),
        { method: 'DELETE', headers: { 'Content-Type': 'application/json' } },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readErrorMessage(payload) ?? t('settings.subscriptions.page.toast.disconnectFailed'));
      }

      setConfirmDisconnect(false);

      // The server schedules its own config reload; respect the reported delay
      // so the refetch sees the post-reload state.
      const reloadDelayMs = isRecord(payload) && typeof payload.reloadDelayMs === 'number'
        ? Math.max(0, Math.min(10000, payload.reloadDelayMs))
        : 0;
      if (reloadDelayMs > 0) {
        await sleep(reloadDelayMs);
      }
      await onChanged();
      toast.success(t('settings.subscriptions.page.toast.disconnected'));
    } catch (error) {
      console.error('Failed to disconnect provider:', error);
      toast.error(
        error instanceof Error && error.message
          ? error.message
          : t('settings.subscriptions.page.toast.disconnectFailed'),
      );
    } finally {
      setBusyKey(null);
    }
  };

  const handleOAuthStart = async (method: SubscriptionOAuthMethod) => {
    if (status !== 'ready') return;
    const methodKey = `${method.index}`;
    const prompts = mergePrompts(method.prompts, oauthExtraPrompts[methodKey]);
    const answers = oauthPromptAnswers[methodKey] ?? {};
    const activePrompts = prompts.filter((prompt) => isOAuthPromptActive(prompt, answers));
    const missing = activePrompts.some((prompt) => !(answers[prompt.key] ?? '').trim());
    if (missing) {
      setOauthError(methodKey, t('settings.subscriptions.page.auth.promptRequired'));
      return;
    }

    setBusyKey(`oauth:${method.index}`);
    try {
      const response = await fetch(
        resolveApiUrl(`/api/provider/${encodeURIComponent(provider.id)}/oauth/authorize`, baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            method: method.index,
            ...Object.fromEntries(
              activePrompts.map((prompt) => [prompt.key, answers[prompt.key]]),
            ),
          }),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        // Some providers (e.g. github-copilot) reject the first authorize call
        // with 400 and advertise additional required prompts. Surface those
        // fields instead of failing silently.
        const additionalPrompts = isRecord(payload) ? parseOAuthPrompts(payload) : [];
        if (additionalPrompts.length > 0) {
          setOauthExtraPrompts((prev) => ({
            ...prev,
            [methodKey]: mergePrompts(prev[methodKey] ?? [], additionalPrompts),
          }));
        }
        throw new Error(readErrorMessage(payload) ?? t('settings.subscriptions.page.toast.oauthStartFailed'));
      }

      const dataRecord = isRecord(payload) && isRecord(payload.data) ? payload.data : (isRecord(payload) ? payload : {});
      const urlCandidate =
        (typeof dataRecord.url === 'string' && dataRecord.url) ||
        (typeof dataRecord.verification_uri_complete === 'string' && dataRecord.verification_uri_complete) ||
        (typeof dataRecord.verification_uri === 'string' && dataRecord.verification_uri) ||
        undefined;
      const instructions =
        (typeof dataRecord.instructions === 'string' && dataRecord.instructions) ||
        (typeof dataRecord.message === 'string' && dataRecord.message) ||
        undefined;
      const userCode =
        (typeof dataRecord.user_code === 'string' && dataRecord.user_code) ||
        (typeof dataRecord.userCode === 'string' && dataRecord.userCode) ||
        (typeof dataRecord.code === 'string' && dataRecord.code) ||
        undefined;

      if (!urlCandidate && !instructions && !userCode) {
        throw new Error(t('settings.subscriptions.page.toast.oauthDetailsMissing'));
      }

      setOauthDetails((prev) => ({ ...prev, [methodKey]: { url: urlCandidate, instructions, userCode } }));
      setOauthError(methodKey, null);
      if (urlCandidate) {
        void openExternalUrl(urlCandidate);
      }
      setOauthPending(methodKey);
      toast.message(t('settings.subscriptions.page.toast.completeOAuthInBrowser'));
    } catch (error) {
      console.error('Failed to start OAuth flow:', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('settings.subscriptions.page.toast.oauthStartFailed');
      setOauthError(methodKey, message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const handleOAuthComplete = async (method: SubscriptionOAuthMethod) => {
    if (status !== 'ready') return;
    const methodKey = `${method.index}`;
    const code = oauthCodes[methodKey]?.trim();

    setBusyKey(`oauth-complete:${method.index}`);
    try {
      const requestBody: { method: number; code?: string } = { method: method.index };
      if (code) {
        requestBody.code = code;
      }

      const response = await fetch(
        resolveApiUrl(`/api/provider/${encodeURIComponent(provider.id)}/oauth/callback`, baseUrl),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(requestBody),
        },
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(readErrorMessage(payload) ?? t('settings.subscriptions.page.toast.oauthCompleteFailed'));
      }

      setOauthCodes((prev) => ({ ...prev, [methodKey]: '' }));
      setOauthPending(null);
      setOauthDetails((prev) => {
        const next = { ...prev };
        delete next[methodKey];
        return next;
      });
      setOauthError(methodKey, null);

      await reloadInstanceConfig();
      await onChanged();
      toast.success(t('settings.subscriptions.page.toast.oauthCompleted'));
    } catch (error) {
      console.error('Failed to complete OAuth flow:', error);
      const message =
        error instanceof Error && error.message
          ? error.message
          : t('settings.subscriptions.page.toast.oauthCompleteFailed');
      setOauthError(methodKey, message);
      toast.error(message);
    } finally {
      setBusyKey(null);
    }
  };

  const handleCopy = async (text: string, kind: 'link' | 'code') => {
    const result = await copyTextToClipboard(text);
    if (result.ok) {
      toast.success(t(kind === 'link'
        ? 'settings.subscriptions.page.toast.oauthLinkCopied'
        : 'settings.subscriptions.page.toast.deviceCodeCopied'));
      return;
    }
    console.error('Failed to copy to clipboard:', result.error);
    toast.error(t(kind === 'link'
      ? 'settings.subscriptions.page.toast.oauthLinkCopyFailed'
      : 'settings.subscriptions.page.toast.deviceCodeCopyFailed'));
  };

  return (
    <div className="mt-1 space-y-3 border-t border-[var(--surface-subtle)] pt-3">
      {/* API key + disconnect row */}
      {!showApiKeyForm ? (
        <div className="flex flex-wrap items-center gap-2 py-0.5">
          <Button
            variant="outline"
            size="xs"
            className="!font-normal"
            onClick={() => setShowApiKeyForm(true)}
          >
            {t('settings.subscriptions.page.actions.setApiKey')}
          </Button>
          {provider.auth.configured && !confirmDisconnect && (
            <Button
              variant="destructive"
              size="xs"
              className="!font-normal"
              onClick={() => setConfirmDisconnect(true)}
            >
              {t('settings.subscriptions.page.actions.disconnect')}
            </Button>
          )}
        </div>
      ) : (
        <div className="py-0.5">
          <label className="typography-ui-label text-foreground">
            {t('settings.subscriptions.page.auth.apiKeyLabel')}
          </label>
          <div className="mt-1.5 flex flex-col gap-2 sm:flex-row sm:items-center">
            <Input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder={t('settings.subscriptions.page.auth.apiKeyPlaceholder')}
              className="h-7 flex-1 font-mono text-xs"
              autoComplete="off"
              aria-label={t('settings.subscriptions.page.auth.apiKeyLabel')}
            />
            <div className="flex shrink-0 gap-2">
              <Button
                size="xs"
                className="!font-normal"
                onClick={() => void handleSaveApiKey()}
                disabled={busyKey === 'api'}
              >
                {busyKey === 'api'
                  ? t('settings.subscriptions.page.actions.saving')
                  : t('settings.subscriptions.page.actions.saveKey')}
              </Button>
              <Button
                variant="ghost"
                size="xs"
                className="!font-normal"
                onClick={() => {
                  setApiKey('');
                  setShowApiKeyForm(false);
                }}
                disabled={busyKey === 'api'}
              >
                {t('settings.subscriptions.page.actions.cancel')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Disconnect confirmation */}
      {confirmDisconnect && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--status-error-border)] bg-[var(--status-error-background)] px-3 py-2">
          <p className="typography-meta text-[var(--status-error)]">
            {t('settings.subscriptions.page.auth.disconnectConfirm')}
          </p>
          <div className="flex shrink-0 gap-2">
            <Button
              variant="destructive"
              size="xs"
              className="!font-normal"
              onClick={() => void handleDisconnect()}
              disabled={busyKey === 'disconnect'}
            >
              {busyKey === 'disconnect'
                ? t('settings.subscriptions.page.actions.disconnecting')
                : t('settings.subscriptions.page.actions.confirmDisconnect')}
            </Button>
            <Button
              variant="ghost"
              size="xs"
              className="!font-normal"
              onClick={() => setConfirmDisconnect(false)}
              disabled={busyKey === 'disconnect'}
            >
              {t('settings.subscriptions.page.actions.cancel')}
            </Button>
          </div>
        </div>
      )}

      {/* OAuth methods */}
      {oauthMethods.length > 0 && (
        <div className="space-y-4 border-t border-[var(--surface-subtle)] pt-3">
          {oauthMethods.map((method) => {
            const methodKey = `${method.index}`;
            const methodLabel = method.label
              || t('settings.subscriptions.page.auth.oauthMethodFallback', { index: String(method.index + 1) });
            const prompts = mergePrompts(method.prompts, oauthExtraPrompts[methodKey]);
            const answers = oauthPromptAnswers[methodKey] ?? {};
            const activePrompts = prompts.filter((prompt) => isOAuthPromptActive(prompt, answers));
            const details = oauthDetails[methodKey];
            const isPending = oauthPending === methodKey;
            const inlineError = oauthErrors[methodKey];

            return (
              <div key={methodKey} className="space-y-3">
                <div className="flex items-center justify-between gap-2">
                  <span className="typography-ui-label text-foreground">{methodLabel}</span>
                  <Button
                    variant="outline"
                    size="xs"
                    className="!font-normal shrink-0"
                    onClick={() => void handleOAuthStart(method)}
                    disabled={busyKey === `oauth:${method.index}`}
                  >
                    {t('settings.subscriptions.page.actions.loginWith', { label: provider.name || provider.id })}
                  </Button>
                </div>

                {activePrompts.length > 0 && (
                  <div className="space-y-2">
                    {activePrompts.map((prompt) => {
                      const answer = answers[prompt.key] ?? '';
                      if (prompt.type === 'select') {
                        return (
                          <div key={prompt.key}>
                            <div className="typography-meta text-muted-foreground">{prompt.label}</div>
                            <div
                              className="mt-1 flex flex-wrap items-center gap-1"
                              role="radiogroup"
                              aria-label={prompt.label}
                            >
                              {prompt.options.map((option) => (
                                <Button
                                  key={option.value}
                                  variant="chip"
                                  size="xs"
                                  className="!font-normal"
                                  role="radio"
                                  aria-checked={answer === option.value}
                                  onClick={() =>
                                    setOauthPromptAnswers((prev) => ({
                                      ...prev,
                                      [methodKey]: { ...(prev[methodKey] ?? {}), [prompt.key]: option.value },
                                    }))
                                  }
                                >
                                  {option.label}
                                </Button>
                              ))}
                            </div>
                          </div>
                        );
                      }
                      return (
                        <div key={prompt.key}>
                          <div className="typography-meta text-muted-foreground">{prompt.label}</div>
                          <Input
                            className="mt-1 h-7"
                            value={answer}
                            placeholder={prompt.placeholder}
                            aria-label={prompt.label}
                            onChange={(event) =>
                              setOauthPromptAnswers((prev) => ({
                                ...prev,
                                [methodKey]: { ...(prev[methodKey] ?? {}), [prompt.key]: event.target.value },
                              }))
                            }
                          />
                        </div>
                      );
                    })}
                  </div>
                )}

                {inlineError && (
                  <p className="typography-meta text-[var(--status-error)]">{inlineError}</p>
                )}

                {details?.instructions && (
                  <p className="rounded border border-[var(--status-info-border)] bg-[var(--status-info-background)] px-2 py-1.5 typography-meta text-[var(--status-info)]">
                    {details.instructions}
                  </p>
                )}

                {details?.userCode && (
                  <div className="flex items-center gap-2">
                    <Input
                      value={details.userCode}
                      readOnly
                      className="h-7 font-mono text-center tracking-widest"
                      aria-label={t('settings.subscriptions.page.auth.deviceCodeLabel')}
                    />
                    <Button
                      variant="outline"
                      size="xs"
                      className="!font-normal shrink-0"
                      onClick={() => void handleCopy(details.userCode ?? '', 'code')}
                    >
                      {t('settings.subscriptions.page.actions.copyCode')}
                    </Button>
                  </div>
                )}

                {details?.url && (
                  <div className="flex items-center gap-2">
                    <Input
                      value={details.url}
                      readOnly
                      className="h-7 text-xs text-muted-foreground"
                      aria-label={t('settings.subscriptions.page.auth.authorizationUrlLabel')}
                    />
                    <div className="flex shrink-0 gap-1">
                      <Button
                        variant="outline"
                        size="xs"
                        className="!font-normal"
                        onClick={() => void openExternalUrl(details.url ?? '')}
                      >
                        {t('settings.subscriptions.page.actions.open')}
                      </Button>
                      <Button
                        variant="outline"
                        size="xs"
                        className="!font-normal"
                        onClick={() => void handleCopy(details.url ?? '', 'link')}
                      >
                        {t('settings.subscriptions.page.actions.copy')}
                      </Button>
                    </div>
                  </div>
                )}

                {isPending && (
                  <div className="flex items-center gap-2">
                    <Input
                      value={oauthCodes[methodKey] ?? ''}
                      onChange={(event) =>
                        setOauthCodes((prev) => ({ ...prev, [methodKey]: event.target.value }))
                      }
                      placeholder={t('settings.subscriptions.page.auth.pasteCodePlaceholder')}
                      className="h-7 font-mono text-xs"
                      aria-label={t('settings.subscriptions.page.auth.pasteCodePlaceholder')}
                    />
                    <Button
                      size="xs"
                      className="!font-normal shrink-0"
                      onClick={() => void handleOAuthComplete(method)}
                      disabled={busyKey === `oauth-complete:${method.index}`}
                    >
                      {busyKey === `oauth-complete:${method.index}`
                        ? t('settings.subscriptions.page.actions.saving')
                        : t('settings.subscriptions.page.actions.complete')}
                    </Button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
};
