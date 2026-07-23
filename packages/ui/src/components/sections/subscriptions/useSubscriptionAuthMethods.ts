import React from 'react';
import { useSettingsServerBaseUrl } from '@/hooks/useSettingsServerBaseUrl';
import { resolveApiUrl } from '@/lib/api/serverUrl';

export interface OAuthPromptOption {
  value: string;
  label: string;
}

export interface OAuthPrompt {
  key: string;
  type: 'select' | 'text';
  label: string;
  options: OAuthPromptOption[];
  placeholder?: string;
  /** Conditional visibility: only active when answers[key] === value (eq semantics). */
  when?: { key: string; value: string };
}

export interface SubscriptionOAuthMethod {
  /** Index within the provider's full advertised method array (required by authorize/callback). */
  index: number;
  label: string;
  prompts: OAuthPrompt[];
}

interface UseSubscriptionAuthMethodsResult {
  /** OAuth methods by provider id. Empty when discovery fails or is still loading. */
  oauthMethodsByProvider: Record<string, SubscriptionOAuthMethod[]>;
  isLoading: boolean;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null;

const normalizeAuthType = (entry: Record<string, unknown>): string => {
  const raw = typeof entry.type === 'string' ? entry.type : '';
  const label = `${typeof entry.name === 'string' ? entry.name : ''} ${typeof entry.label === 'string' ? entry.label : ''}`;
  const merged = `${raw} ${label}`.toLowerCase();
  if (merged.includes('oauth')) return 'oauth';
  if (merged.includes('api')) return 'api';
  return raw.toLowerCase();
};

const parsePromptOption = (entry: unknown): OAuthPromptOption | null => {
  if (typeof entry === 'string' && entry.length > 0) {
    return { value: entry, label: entry };
  }
  if (!isRecord(entry)) {
    return null;
  }
  const value =
    (typeof entry.value === 'string' && entry.value) ||
    (typeof entry.id === 'string' && entry.id) ||
    (typeof entry.key === 'string' && entry.key) ||
    '';
  if (!value) {
    return null;
  }
  const label =
    (typeof entry.label === 'string' && entry.label) ||
    (typeof entry.name === 'string' && entry.name) ||
    value;
  return { value, label };
};

const parsePrompt = (entry: unknown): OAuthPrompt | null => {
  if (!isRecord(entry)) {
    return null;
  }
  const key =
    (typeof entry.key === 'string' && entry.key) ||
    (typeof entry.name === 'string' && entry.name) ||
    (typeof entry.id === 'string' && entry.id) ||
    '';
  if (!key) {
    return null;
  }
  const rawType = typeof entry.type === 'string' ? entry.type.toLowerCase() : '';
  const options = Array.isArray(entry.options)
    ? entry.options.map(parsePromptOption).filter((option): option is OAuthPromptOption => Boolean(option))
    : [];
  const type: OAuthPrompt['type'] = rawType === 'select' || options.length > 0 ? 'select' : 'text';
  const label =
    (typeof entry.message === 'string' && entry.message) ||
    (typeof entry.label === 'string' && entry.label) ||
    (typeof entry.title === 'string' && entry.title) ||
    key;
  const placeholder = typeof entry.placeholder === 'string' ? entry.placeholder : undefined;
  const when = isRecord(entry.when)
    && typeof entry.when.key === 'string'
    && typeof entry.when.value === 'string'
    && (entry.when.op === undefined || entry.when.op === 'eq')
    ? { key: entry.when.key, value: entry.when.value }
    : undefined;
  return { key, type, label, options, placeholder, when };
};

export const parseOAuthPrompts = (entry: Record<string, unknown>): OAuthPrompt[] => {
  const source = Array.isArray(entry.prompts)
    ? entry.prompts
    : isRecord(entry.data) && Array.isArray(entry.data.prompts)
      ? entry.data.prompts
      : [];
  return source.map(parsePrompt).filter((prompt): prompt is OAuthPrompt => Boolean(prompt));
};

export const isOAuthPromptActive = (prompt: OAuthPrompt, answers: Record<string, string>): boolean => {
  if (!prompt.when) {
    return true;
  }
  return (answers[prompt.when.key] ?? '') === prompt.when.value;
};

/**
 * Fetches advertised provider auth methods (`GET /api/provider/auth`) for the
 * selected settings instance and exposes only the OAuth methods, keeping the
 * original array index (the authorize/callback API requires it). Discovery
 * failure is non-fatal: the hook returns empty maps so the OAuth UI hides.
 */
export function useSubscriptionAuthMethods(): UseSubscriptionAuthMethodsResult {
  const { status, baseUrl } = useSettingsServerBaseUrl();
  const [oauthMethodsByProvider, setOauthMethodsByProvider] = React.useState<Record<string, SubscriptionOAuthMethod[]>>({});
  const [isLoading, setIsLoading] = React.useState(false);

  React.useEffect(() => {
    setOauthMethodsByProvider({});
    if (status !== 'ready') {
      setIsLoading(false);
      return;
    }
    let isMounted = true;

    const load = async () => {
      setIsLoading(true);
      try {
        const response = await fetch(resolveApiUrl('/api/provider/auth', baseUrl), {
          method: 'GET',
          headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
          throw new Error(`Auth methods request failed (${response.status})`);
        }
        const payload = await response.json().catch(() => null);
        if (!isMounted) return;
        const next: Record<string, SubscriptionOAuthMethod[]> = {};
        if (isRecord(payload)) {
          for (const [providerId, value] of Object.entries(payload)) {
            if (!Array.isArray(value)) {
              continue;
            }
            const oauthMethods: SubscriptionOAuthMethod[] = [];
            value.forEach((entry, index) => {
              if (!isRecord(entry) || normalizeAuthType(entry) !== 'oauth') {
                return;
              }
              const label =
                (typeof entry.label === 'string' && entry.label) ||
                (typeof entry.name === 'string' && entry.name) ||
                '';
              oauthMethods.push({ index, label, prompts: parseOAuthPrompts(entry) });
            });
            if (oauthMethods.length > 0) {
              next[providerId] = oauthMethods;
            }
          }
        }
        setOauthMethodsByProvider(next);
      } catch (error) {
        if (!isMounted) return;
        // Discovery failure must not break the page; OAuth UI stays hidden.
        if (error instanceof Error) {
          console.error('Failed to load provider auth methods:', error);
        } else {
          console.error('Failed to load provider auth methods');
        }
        setOauthMethodsByProvider({});
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void load();

    return () => {
      isMounted = false;
    };
  }, [status, baseUrl]);

  return { oauthMethodsByProvider, isLoading };
}
