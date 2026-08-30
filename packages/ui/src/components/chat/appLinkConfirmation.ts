import { getUrlScheme, isAppLinkUrl, openConfirmedAppLinkUrl } from '@/lib/url';
import { useAppLinkTrustStore } from '@/stores/appLinkTrustStore';

export type AppLinkConfirmationChoice = 'open' | 'trust' | 'cancel';

type PendingAppLinkRequest = {
  url: string;
  resolve: (choice: AppLinkConfirmationChoice) => void;
};

let pendingRequest: PendingAppLinkRequest | null = null;
const listeners = new Set<() => void>();
const emitChange = () => listeners.forEach((listener) => listener());

export const openAppLinkWithConfirmation = (url: string): Promise<void> => {
  const scheme = getUrlScheme(url);
  if (!scheme || !isAppLinkUrl(url)) return Promise.resolve();
  const trustStore = useAppLinkTrustStore.getState();
  if (trustStore.isSchemeTrusted(scheme)) {
    return openConfirmedAppLinkUrl(url).then(() => undefined);
  }
  pendingRequest?.resolve('cancel');
  return new Promise<AppLinkConfirmationChoice>((resolve) => {
    pendingRequest = { url, resolve };
    emitChange();
  }).then((choice) => {
    if (choice === 'trust') trustStore.trustScheme(scheme);
    if (choice === 'open' || choice === 'trust') return openConfirmedAppLinkUrl(url).then(() => undefined);
  });
};

export const settleAppLinkConfirmation = (choice: AppLinkConfirmationChoice) => {
  const request = pendingRequest;
  pendingRequest = null;
  emitChange();
  request?.resolve(choice);
};

export const subscribeAppLinkConfirmation = (listener: () => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
export const getAppLinkConfirmationSnapshot = () => pendingRequest;
