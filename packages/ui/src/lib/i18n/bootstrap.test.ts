import { describe, expect, test } from 'bun:test';
import { getBootstrapMessages } from './bootstrap';
import { LOCALES } from './runtime';

describe('bootstrap messages', () => {
  test('provides complete messages for every supported locale', () => {
    for (const locale of LOCALES) {
      const messages = getBootstrapMessages(locale);

      expect(messages.startingApi.length).toBeGreaterThan(0);
      expect(messages.connectionError.length).toBeGreaterThan(0);
      expect(messages.loadingData(messages.providersReady, messages.agentsLoading).length).toBeGreaterThan(0);
      expect(messages.waitingDevServer('localhost:5173', 2)).toContain('2');
    }
  });

  test('uses the selected locale before React mounts', () => {
    expect(getBootstrapMessages('zh-CN').startingApi).toBe('正在启动 OpenCode API…');
    expect(getBootstrapMessages('es').connectionError).toBe('Error de conexión');
    expect(getBootstrapMessages('ja').startingApi).toBe('OpenCode API を起動中…');
  });
});
