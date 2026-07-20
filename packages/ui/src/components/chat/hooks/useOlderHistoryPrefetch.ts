import React from 'react';

import {
    getOlderHistoryPrefetchThreshold,
    shouldPrefetchOlderHistory,
    shouldStartOlderHistoryPrefetch,
} from '../lib/scroll/scrollIntent';

type UseOlderHistoryPrefetchOptions = {
    readonly historyVersion: string;
    readonly hasMoreAbove: boolean;
    readonly isLoadingOlder: boolean;
    readonly resolveScrollContainer: () => HTMLDivElement | null;
    readonly onLoadOlder: (options: { readonly userInitiated: boolean }) => Promise<void>;
};

export const useOlderHistoryPrefetch = (
    options: UseOlderHistoryPrefetchOptions,
): React.RefObject<HTMLDivElement | null> => {
    const {
        historyVersion,
        hasMoreAbove,
        isLoadingOlder,
        resolveScrollContainer,
        onLoadOlder,
    } = options;
    const sentinelRef = React.useRef<HTMLDivElement | null>(null);
    const requestPendingRef = React.useRef(false);
    const attemptedVersionRef = React.useRef<string | null>(null);

    React.useEffect(() => {
        const container = resolveScrollContainer();
        const sentinel = sentinelRef.current;
        if (!container || !sentinel || !hasMoreAbove) {
            return;
        }

        const requestOlderHistory = (isWithinRange: boolean) => {
            if (!shouldStartOlderHistoryPrefetch({
                historyVersion,
                attemptedVersion: attemptedVersionRef.current,
                requestPending: requestPendingRef.current,
                isLoadingOlder,
                isWithinRange,
            })) {
                return;
            }

            attemptedVersionRef.current = historyVersion;
            requestPendingRef.current = true;
            const finishRequest = () => {
                requestPendingRef.current = false;
            };
            void onLoadOlder({ userInitiated: false }).then(finishRequest, finishRequest);
        };

        const markOutsideRange = () => {
            if (!requestPendingRef.current) {
                attemptedVersionRef.current = null;
            }
        };

        if (typeof IntersectionObserver !== 'undefined') {
            const prefetchThreshold = getOlderHistoryPrefetchThreshold(container.clientHeight);
            const observer = new IntersectionObserver((entries) => {
                const isWithinRange = entries.some((entry) => entry.target === sentinel && entry.isIntersecting);
                if (!isWithinRange) {
                    markOutsideRange();
                    return;
                }
                requestOlderHistory(true);
            }, {
                root: container,
                rootMargin: `${prefetchThreshold}px 0px 0px 0px`,
            });
            observer.observe(sentinel);
            return () => observer.disconnect();
        }

        const handleScroll = () => {
            const isWithinRange = shouldPrefetchOlderHistory({
                scrollTop: container.scrollTop,
                clientHeight: container.clientHeight,
            });
            if (!isWithinRange) {
                markOutsideRange();
                return;
            }
            requestOlderHistory(true);
        };
        container.addEventListener('scroll', handleScroll, { passive: true });
        handleScroll();
        return () => container.removeEventListener('scroll', handleScroll);
    }, [hasMoreAbove, historyVersion, isLoadingOlder, onLoadOlder, resolveScrollContainer]);

    return sentinelRef;
};
