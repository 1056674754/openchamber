import { describe, expect, test } from 'bun:test';

import { attachAppLinkInteractions } from './appLinkInteractions';

const TestElement = class Element {};
const TestHTMLAnchorElement = class HTMLAnchorElement extends TestElement {};
Object.assign(globalThis, { Element: TestElement, HTMLAnchorElement: TestHTMLAnchorElement });

class Anchor extends HTMLAnchorElement {
  constructor(private readonly rawHref: string) { super(); }
  getAttribute(name: string) { return name === 'href' ? this.rawHref : null; }
  closest() { return this; }
}

class Container {
  listeners = new Map<string, (event: Event) => void>();
  addEventListener(name: string, listener: EventListener) { this.listeners.set(name, listener); }
  removeEventListener(name: string) { this.listeners.delete(name); }
  dispatch(name: string, href: string, button = 0) {
    const event = new Event(name, { cancelable: true });
    Object.defineProperties(event, {
      target: { value: new Anchor(href) }, button: { value: button },
      metaKey: { value: false }, ctrlKey: { value: false }, altKey: { value: false }, shiftKey: { value: false },
    });
    this.listeners.get(name)?.(event);
    return event;
  }
}

describe('app link interactions', () => {
  test('intercepts primary, middle, and drag activation without bypassing confirmation', () => {
    const container = new Container();
    const opened: string[] = [];
    attachAppLinkInteractions(container, { allowExternalHttp: true, openAppLink: (url) => opened.push(url), openExternalHttp: () => undefined });
    expect(container.dispatch('click', 'spotify://track/1').defaultPrevented).toBe(true);
    expect(container.dispatch('auxclick', 'spotify://track/1', 1).defaultPrevented).toBe(true);
    expect(container.dispatch('dragstart', 'spotify://track/1').defaultPrevented).toBe(true);
    expect(opened).toEqual(['spotify://track/1', 'spotify://track/1']);
  });

  test('keeps dangerous schemes blocked from the app-link opener', () => {
    const container = new Container();
    const opened: string[] = [];
    attachAppLinkInteractions(container, { allowExternalHttp: true, openAppLink: (url) => opened.push(url), openExternalHttp: () => undefined });
    container.dispatch('click', 'javascript:alert(1)');
    expect(opened).toEqual([]);
  });
});
