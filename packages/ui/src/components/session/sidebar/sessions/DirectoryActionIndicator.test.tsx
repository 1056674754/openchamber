import { afterEach, beforeEach, expect, test } from 'bun:test';
import React, { act, Profiler } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { Window } from 'happy-dom';
import { I18nProvider } from '@/lib/i18n';
import { useTerminalStore, type TerminalProjectActionRun } from '@/stores/useTerminalStore';
import { DirectoryActionIndicator } from './DirectoryActionIndicator';

// [fork-port] The fork tracks project actions as explicit runs in
// `projectActionRuns` instead of upstream's tab lifecycle flags, so this test
// drives the run record directly. Assertions mirror the upstream behaviors:
// only live actions in the exact directory show, and unrelated store churn
// must not rerender the indicator.

const run = (key: string, directory: string, status: TerminalProjectActionRun['status'] = 'running'): TerminalProjectActionRun => ({
  key,
  directory,
  serverId: 'default',
  actionId: 'dev',
  tabId: `tab-${key}`,
  sessionId: `session-${key}`,
  status,
});

let browser: Window;
let root: Root;
const descriptors = new Map<string, PropertyDescriptor | undefined>();
beforeEach(() => {
  browser = new Window({ url: 'http://localhost' });
  for (const [key, value] of Object.entries({ window: browser, document: browser.document, navigator: browser.navigator, HTMLElement: browser.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true })) {
    descriptors.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { value, configurable: true });
  }
  const host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  useTerminalStore.getState().clearAll();
});
afterEach(async () => {
  await act(async () => root.unmount());
  useTerminalStore.getState().clearAll();
  await browser.happyDOM.close();
  for (const [key, descriptor] of descriptors) {
    if (descriptor) Object.defineProperty(globalThis, key, descriptor);
    else Reflect.deleteProperty(globalThis, key);
  }
});

test('shows only live actions in its exact directory and follows start, stop and removal', async () => {
  await act(async () => root.render(<I18nProvider><DirectoryActionIndicator directory="/repo/" /><DirectoryActionIndicator directory="/repo/worktree" /></I18nProvider>));
  const store = useTerminalStore.getState();
  expect(document.querySelectorAll('[data-action-directory]')).toHaveLength(0);
  await act(async () => { store.setProjectActionRun(run('run-1', '/repo')); });
  expect(document.querySelectorAll('[data-action-directory]')).toHaveLength(1);
  expect(document.querySelector('[data-action-directory]')?.getAttribute('data-action-directory')).toBe('/repo');
  expect(document.querySelector('use')?.getAttribute('href')).toBe('#oc-pulse');
  await act(async () => { store.updateProjectActionRunStatus('run-1', 'stopping'); });
  expect(document.querySelectorAll('[data-action-directory]')).toHaveLength(1);
  await act(async () => { store.removeProjectActionRun('run-1'); });
  expect(document.querySelectorAll('[data-action-directory]')).toHaveLength(0);
});

test('500 indicators do not rerender for another directory changing', async () => {
  const store = useTerminalStore.getState();
  store.setProjectActionRun(run('run-1', '/repo'));
  let renders = 0;
  await act(async () => root.render(<I18nProvider><Profiler id="indicators" onRender={() => { renders += 1; }}>
    {Array.from({ length: 500 }, (_, index) => <DirectoryActionIndicator key={index} directory="/repo" />)}
  </Profiler></I18nProvider>));
  expect(document.querySelectorAll('[data-action-directory]')).toHaveLength(500);
  renders = 0;
  await act(async () => {
    store.setProjectActionRun(run('run-2', '/unrelated'));
  });
  expect(renders).toBe(0);
  await act(async () => { store.removeProjectActionRun('run-1'); });
  expect(renders).toBeGreaterThan(0);
  expect(document.querySelectorAll('[data-action-directory]')).toHaveLength(0);
});
