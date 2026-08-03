import React from 'react';
import { useStickyHeadersStore } from '../stickyHeadersStore';

type Args = {
  enabled?: boolean;
  isDesktopShellRuntime: boolean;
  projectSections: unknown[];
  projectHeaderSentinelRefs: React.RefObject<Map<string, HTMLDivElement | null>>;
};

type StickyHeaderArgs = {
  enabled: boolean;
  isDesktopShellRuntime: boolean;
};

export const useStickyHeader = (args: StickyHeaderArgs) => {
  const { enabled, isDesktopShellRuntime } = args;
  const [sentinel, setSentinel] = React.useState<HTMLDivElement | null>(null);
  const [isStuck, setIsStuck] = React.useState(false);

  const sentinelRef = React.useCallback((node: HTMLDivElement | null) => {
    setSentinel(node);
  }, []);

  React.useEffect(() => {
    if (!enabled || !isDesktopShellRuntime || !sentinel) {
      setIsStuck(false);
      return;
    }

    const observer = new IntersectionObserver(([entry]) => {
      const root = sentinel.closest<HTMLElement>('.oc-sidebar-scroller');
      const rootTop = entry.rootBounds?.top ?? root?.getBoundingClientRect().top ?? 0;
      setIsStuck(!entry.isIntersecting && entry.boundingClientRect.top < rootTop);
    }, { root: sentinel.closest<HTMLElement>('.oc-sidebar-scroller'), threshold: 0 });

    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [enabled, isDesktopShellRuntime, sentinel]);

  return { isStuck, sentinelRef };
};

export const useStickyProjectHeaders = (args: Args): void => {
  const { enabled = true, isDesktopShellRuntime, projectSections, projectHeaderSentinelRefs } = args;

  React.useEffect(() => {
    if (enabled && isDesktopShellRuntime) {
      return;
    }

    useStickyHeadersStore.getState().clearAll();
  }, [enabled, isDesktopShellRuntime]);

  React.useEffect(() => {
    if (!enabled || !isDesktopShellRuntime) {
      return;
    }

    const firstSentinel = Array.from(projectHeaderSentinelRefs.current.values()).find((element) => element !== null);
    const root = firstSentinel?.closest<HTMLElement>('.oc-sidebar-scroller') ?? null;
    if (!root) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const store = useStickyHeadersStore.getState();
        entries.forEach((entry) => {
          const projectId = (entry.target as HTMLElement).dataset.projectId;
          if (!projectId) {
            return;
          }

          const rootTop = entry.rootBounds?.top ?? root.getBoundingClientRect().top;
          store.setStuck(projectId, !entry.isIntersecting && entry.boundingClientRect.top < rootTop);
        });
      },
      { root, threshold: 0 },
    );

    projectHeaderSentinelRefs.current.forEach((el) => {
      if (el) {
        observer.observe(el);
      }
    });

    return () => observer.disconnect();
  }, [enabled, isDesktopShellRuntime, projectHeaderSentinelRefs, projectSections]);
};
