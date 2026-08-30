type EmbeddedSessionChatLocation = {
  readonly isEmbedded: boolean;
  readonly originSessionId: string | null;
};

export const parseEmbeddedSessionChatLocation = (search: string): EmbeddedSessionChatLocation => {
  const params = new URLSearchParams(search);
  const isEmbedded = params.get('ocPanel') === 'session-chat';
  const sessionId = params.get('sessionId')?.trim() ?? '';
  return {
    isEmbedded,
    originSessionId: isEmbedded && sessionId ? sessionId : null,
  };
};

let embeddedLocationCache: EmbeddedSessionChatLocation | null = null;

const getEmbeddedLocation = (): EmbeddedSessionChatLocation => {
  if (embeddedLocationCache) return embeddedLocationCache;
  embeddedLocationCache = parseEmbeddedSessionChatLocation(
    typeof window === 'undefined' ? '' : window.location.search,
  );
  return embeddedLocationCache;
};

export const isEmbeddedSessionChat = (): boolean => getEmbeddedLocation().isEmbedded;

export const getEmbeddedSessionChatOriginSessionId = (): string | null =>
  getEmbeddedLocation().originSessionId;

export const resetEmbeddedSessionChatLocationCache = (): void => {
  embeddedLocationCache = null;
};

export const canPostMessageToParentFrame = (
  targetWindow: { readonly parent?: unknown } | undefined,
): boolean => {
  if (!targetWindow?.parent) return false;
  return targetWindow.parent !== targetWindow;
};

export const buildEmbeddedSessionChatURL = (
  sessionID: string,
  directory: string | null,
  readOnly: boolean,
): string => {
  if (typeof window === 'undefined') return '';

  const url = new URL(window.location.pathname, window.location.origin);
  url.searchParams.set('ocPanel', 'session-chat');
  url.searchParams.set('sessionId', sessionID);
  if (readOnly) url.searchParams.set('readOnly', '1');
  if (directory?.trim()) url.searchParams.set('directory', directory);
  return url.toString();
};

export const getActiveEmbeddedSessionChatTab = <T extends { id: string }>(
  tabs: T[],
  activeTabID: string | null,
): T | null => activeTabID ? tabs.find((tab) => tab.id === activeTabID) ?? null : null;
