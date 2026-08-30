import { describe, expect, test } from 'bun:test';

import { settingsInstanceStatusDotClass } from './settingsInstanceStatus';

describe('settingsInstanceStatusDotClass', () => {
  test('keeps the default instance green', () => {
    expect(settingsInstanceStatusDotClass({ type: 'default' })).toBe('bg-[var(--status-success)]');
  });

  test('uses the live SSH phase for remote instances', () => {
    expect(settingsInstanceStatusDotClass({ type: 'remote' }, 'ready')).toContain('bg-[var(--status-success)]');
    expect(settingsInstanceStatusDotClass({ type: 'remote' }, 'master_connecting')).toContain('bg-[var(--status-warning)]');
    expect(settingsInstanceStatusDotClass({ type: 'remote' }, 'error')).toContain('bg-[var(--status-error)]');
    expect(settingsInstanceStatusDotClass({ type: 'remote' })).toBe('bg-muted-foreground/40');
  });

  test('maps web remote phases without pretending disconnected instances are healthy', () => {
    expect(settingsInstanceStatusDotClass({ type: 'remote' }, 'connected')).toContain('bg-[var(--status-success)]');
    expect(settingsInstanceStatusDotClass({ type: 'remote' }, 'connecting')).toContain('bg-[var(--status-warning)]');
    expect(settingsInstanceStatusDotClass({ type: 'remote' }, 'disconnected')).toBe('bg-muted-foreground/40');
  });
});
