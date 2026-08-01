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
      setIsStuck(entry.intersectionRatio < 1);
    }, { threshold: 1 });

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

    const observer = new IntersectionObserver(
      (entries) => {
        const store = useStickyHeadersStore.getState();
        entries.forEach((entry) => {
          const projectId = (entry.target as HTMLElement).dataset.projectId;
          if (!projectId) {
            return;
          }

          store.setStuck(projectId, !entry.isIntersecting);
        });
      },
      { threshold: 0 },
    );

    projectHeaderSentinelRefs.current.forEach((el) => {
      if (el) {
        observer.observe(el);
      }
    });

    return () => observer.disconnect();
  }, [enabled, isDesktopShellRuntime, projectHeaderSentinelRefs, projectSections]);
};
