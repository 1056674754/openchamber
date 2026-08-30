import { beforeEach, describe, expect, test } from 'bun:test';

import { useAppLinkTrustStore } from '@/stores/appLinkTrustStore';
import { getAppLinkConfirmationSnapshot, openAppLinkWithConfirmation, settleAppLinkConfirmation } from './appLinkConfirmation';

describe('app link confirmation', () => {
  beforeEach(() => {
    useAppLinkTrustStore.setState({ trustedSchemes: [] });
    if (getAppLinkConfirmationSnapshot()) settleAppLinkConfirmation('cancel');
  });

  test('asks once and remembers trust per scheme', async () => {
    const pending = openAppLinkWithConfirmation('obsidian://open?vault=Notes');
    expect(getAppLinkConfirmationSnapshot()?.url).toBe('obsidian://open?vault=Notes');
    settleAppLinkConfirmation('trust');
    await pending;
    expect(useAppLinkTrustStore.getState().isSchemeTrusted('obsidian')).toBe(true);
  });

  test('cancel keeps the scheme untrusted and newer requests cancel older ones', async () => {
    const first = openAppLinkWithConfirmation('notion://first');
    const second = openAppLinkWithConfirmation('linear://second');
    await first;
    expect(getAppLinkConfirmationSnapshot()?.url).toBe('linear://second');
    settleAppLinkConfirmation('cancel');
    await second;
    expect(useAppLinkTrustStore.getState().trustedSchemes).toEqual([]);
  });

  test('never asks for a blocked or self-deep-link scheme', async () => {
    await openAppLinkWithConfirmation('javascript:alert(1)');
    await openAppLinkWithConfirmation('openchamber://connect?host=x');
    expect(getAppLinkConfirmationSnapshot()).toBeNull();
    expect(useAppLinkTrustStore.getState().trustedSchemes).toEqual([]);
  });
});
