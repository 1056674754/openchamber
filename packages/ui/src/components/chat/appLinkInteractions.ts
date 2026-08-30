import { isAppLinkUrl, isExternalHttpUrl } from '@/lib/url';

type LinkInteractionContainer = {
  addEventListener: (type: string, listener: EventListener) => void;
  removeEventListener: (type: string, listener: EventListener) => void;
};

type Options = {
  allowExternalHttp: boolean;
  openAppLink: (url: string) => void;
  openExternalHttp: (url: string) => void;
};

const findLink = (event: MouseEvent | DragEvent): HTMLAnchorElement | null => {
  if (!(event.target instanceof Element)) return null;
  const anchor = event.target.closest('a[href]');
  if (!(anchor instanceof HTMLAnchorElement)) return null;
  return anchor.getAttribute('data-openchamber-file-link') === 'true' ? null : anchor;
};

const interceptAppLink = (event: MouseEvent | DragEvent, open?: (url: string) => void) => {
  if (event.defaultPrevented) return false;
  const href = findLink(event)?.getAttribute('href') ?? '';
  if (!isAppLinkUrl(href)) return false;
  event.preventDefault();
  event.stopPropagation();
  open?.(href);
  return true;
};

export const attachAppLinkInteractions = (container: LinkInteractionContainer, options: Options) => {
  const click = (event: MouseEvent) => {
    if (interceptAppLink(event, options.openAppLink)) return;
    if (!options.allowExternalHttp || event.defaultPrevented || event.button !== 0
      || event.metaKey || event.ctrlKey || event.altKey || event.shiftKey) return;
    const href = findLink(event)?.getAttribute('href') ?? '';
    if (!isExternalHttpUrl(href)) return;
    event.preventDefault();
    event.stopPropagation();
    options.openExternalHttp(href);
  };
  const auxclick = (event: MouseEvent) => {
    if (event.button === 1) interceptAppLink(event, options.openAppLink);
  };
  const dragstart = (event: DragEvent) => { interceptAppLink(event); };
  container.addEventListener('click', click as EventListener);
  container.addEventListener('auxclick', auxclick as EventListener);
  container.addEventListener('dragstart', dragstart as EventListener);
  return () => {
    container.removeEventListener('click', click as EventListener);
    container.removeEventListener('auxclick', auxclick as EventListener);
    container.removeEventListener('dragstart', dragstart as EventListener);
  };
};
