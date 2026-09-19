import React, { act } from 'react';
import { expect, test } from 'bun:test';
import { Window } from 'happy-dom';
import type { Session } from '@opencode-ai/sdk/v2';
import { I18nProvider } from '@/lib/i18n';
import { useGlobalSessionsStore } from '@/stores/useGlobalSessionsStore';
import { useNotificationStore } from '@/sync/notification-store';
import { SessionSidebarFolderItem } from './SessionSidebarFolderItem';

// [fork-port] Folder-row activity derives from the fork's global sessions
// store (`sessionStatuses`) and the notification store instead of upstream's
// global-session-status store. A collapsed virtual folder must still surface
// live and unread descendants without mounting them.

test('a collapsed virtual folder shows live and unread descendants without mounting them', async () => {
  const dom = new Window({ url: 'http://localhost' });
  const originals = new Map<string, PropertyDescriptor | undefined>();
  for (const [name, value] of Object.entries({
    window: dom, document: dom.document, navigator: dom.navigator,
    Node: dom.Node, Element: dom.Element, HTMLElement: dom.HTMLElement,
    MutationObserver: dom.MutationObserver, ResizeObserver: dom.ResizeObserver,
    getComputedStyle: dom.getComputedStyle.bind(dom),
    requestAnimationFrame: dom.requestAnimationFrame.bind(dom),
    cancelAnimationFrame: dom.cancelAnimationFrame.bind(dom), IS_REACT_ACT_ENVIRONMENT: true,
  })) {
    originals.set(name, Object.getOwnPropertyDescriptor(globalThis, name));
    Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  }
  const { createRoot } = await import('react-dom/client');
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  const originalNotifications = useNotificationStore.getState();
  const originalGlobalSessions = useGlobalSessionsStore.getState();
  const session = (id: string, parentID?: string): Session => ({
    id, parentID, slug: id, title: id, directory: '/repo', projectID: 'project', version: '1', time: { created: 1, updated: 1 },
  });
  const sessions = [{ session: session('parent'), worktree: null, children: [{ session: session('child', 'parent'), worktree: null, children: [] }] }];
  const render = (notifyOnSubtasks = false, isCollapsed = true, archivedBucket = false) => root.render(
    <I18nProvider><SessionSidebarFolderItem
      folder={{ id: 'folder', name: 'Folder', createdAt: 1, sessionIds: ['parent'] }}
      sessions={[]} activityNodes={sessions} notifyOnSubtasks={notifyOnSubtasks}
      isCollapsed={isCollapsed} archivedBucket={archivedBucket}
      onToggle={() => undefined} onRename={() => undefined} onDelete={() => undefined}
      renderSessionNode={() => null}
    /></I18nProvider>,
  );
  try {
    useGlobalSessionsStore.setState({ sessionStatuses: new Map() });
    useNotificationStore.setState({ list: [], index: { totalUnseenCount: 0, session: { unseenCount: {}, unseenHasError: {} }, project: { unseenCount: {}, unseenHasError: {} } } });
    await act(async () => render());
    await act(async () => useGlobalSessionsStore.setState({ sessionStatuses: new Map([['child', { type: 'busy' } as never]]) }));
    expect(container.querySelector('[aria-label="Session active"]')).not.toBeNull();
    await act(async () => {
      useGlobalSessionsStore.setState({ sessionStatuses: new Map() });
      useNotificationStore.getState().append({ type: 'turn-complete', session: 'child', time: Date.now(), viewed: false });
    });
    expect(container.querySelector('[aria-label="Session active"]')).toBeNull();
    expect(container.querySelector('[aria-label="Unread updates"]')).toBeNull();
    await act(async () => render(true));
    expect(container.querySelector('[aria-label="Unread updates"]')).not.toBeNull();
    await act(async () => render(true, false));
    expect(container.querySelector('[aria-label="Unread updates"]')).toBeNull();
    await act(async () => render(true, true, true));
    expect(container.querySelector('[aria-label="Unread updates"]')).toBeNull();
  } finally {
    await act(async () => root.unmount());
    useGlobalSessionsStore.setState({ sessionStatuses: new Map() });
    useNotificationStore.setState(originalNotifications);
    void originalGlobalSessions;
    container.remove();
    await dom.happyDOM.abort();
    for (const [name, descriptor] of originals) {
      if (descriptor) Object.defineProperty(globalThis, name, descriptor);
      else Reflect.deleteProperty(globalThis, name);
    }
  }
});
