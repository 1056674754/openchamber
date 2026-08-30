import { describe, expect, test } from 'bun:test';

import {
  buildClickScript,
  buildInspectScript,
  buildScrollScript,
  buildSnapshotScript,
  buildTypeScript,
} from './pageActions';

const parses = (source: string): boolean => {
  try {
    new Function(source);
    return true;
  } catch {
    return false;
  }
};

describe('Browser page actions', () => {
  test('all generated scripts parse', () => {
    expect(parses(buildSnapshotScript({ selector: '#main' }))).toBe(true);
    expect(parses(buildClickScript({ text: 'Save' }))).toBe(true);
    expect(parses(buildTypeScript({ selector: '#q', value: 'hello', submit: true }))).toBe(true);
    expect(parses(buildScrollScript({ direction: 'bottom' }))).toBe(true);
    expect(parses(buildInspectScript({ selector: '#save' }))).toBe(true);
  });

  test('embeds hostile selectors and typed values as inert data', () => {
    const selector = `'); window.__owned = true; ('`;
    const value = `"); alert(1); ("`;
    expect(buildClickScript({ selector })).toContain(JSON.stringify(selector));
    expect(buildTypeScript({ selector: '#q', value, submit: false })).toContain(JSON.stringify(value));
  });

  test('keeps snapshots bounded and scoped', () => {
    const script = buildSnapshotScript({ selector: '#changes' });
    expect(script).toContain('MAX_ELEMENTS = 120');
    expect(script).toContain('slice(0, 6000)');
    expect(script).toContain('root.querySelectorAll');
    expect(script).toContain('replace(/\\s+/g');
  });

  test('uses instant scrolling before reporting the resulting position', () => {
    expect(buildScrollScript({ selector: 'footer' })).toContain("behavior: 'instant'");
    expect(buildScrollScript({ direction: 'bottom' })).toContain('requestAnimationFrame');
  });
});
