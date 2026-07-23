import { describe, expect, test } from 'bun:test';

import {
  buildEmbeddedSessionChatURL,
  getEmbeddedSessionChatOriginSessionId,
  isEmbeddedSessionChat,
  parseEmbeddedSessionChatLocation,
  resetEmbeddedSessionChatLocationCache,
} from './contextPanelEmbeddedChat';

const originalWindow = globalThis.window;

const installWindowLocation = (href: string): void => {
  const url = new URL(href);
  Object.defineProperty(globalThis, 'window', {
    configurable: true,
    value: { location: url },
  });
  resetEmbeddedSessionChatLocationCache();
};

const withWindowLocation = (href: string, run: () => void): void => {
  installWindowLocation(href);
  try {
    run();
  } finally {
    Object.defineProperty(globalThis, 'window', {
      configurable: true,
      value: originalWindow,
    });
    resetEmbeddedSessionChatLocationCache();
  }
};

describe('embedded session chat location', () => {
  test('recognizes only the session-chat panel and trims its anchor session', () => {
    expect(parseEmbeddedSessionChatLocation('?ocPanel=session-chat&sessionId=%20ses_child%20')).toEqual({
      isEmbedded: true,
      originSessionId: 'ses_child',
    });
    expect(parseEmbeddedSessionChatLocation('?sessionId=ses_child')).toEqual({
      isEmbedded: false,
      originSessionId: null,
    });
  });

  test('keeps the iframe identity stable after route state changes', () => {
    withWindowLocation(
      'http://127.0.0.1:5173/app?ocPanel=session-chat&sessionId=ses_anchor',
      () => {
        expect(isEmbeddedSessionChat()).toBe(true);
        expect(getEmbeddedSessionChatOriginSessionId()).toBe('ses_anchor');

        window.location.search = '?session=ses_grandchild';
        expect(isEmbeddedSessionChat()).toBe(true);
        expect(getEmbeddedSessionChatOriginSessionId()).toBe('ses_anchor');
      },
    );
  });

  test('builds an embedded URL with directory and read-only context', () => {
    withWindowLocation('http://127.0.0.1:5173/app', () => {
      const url = new URL(buildEmbeddedSessionChatURL('ses_child', '/repo/nested', true));
      expect(url.pathname).toBe('/app');
      expect(url.searchParams.get('ocPanel')).toBe('session-chat');
      expect(url.searchParams.get('sessionId')).toBe('ses_child');
      expect(url.searchParams.get('directory')).toBe('/repo/nested');
      expect(url.searchParams.get('readOnly')).toBe('1');
    });
  });
});
