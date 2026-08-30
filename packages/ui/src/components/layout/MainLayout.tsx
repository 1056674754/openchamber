import React, { useRef, useEffect } from 'react';
import { motion, useMotionValue, animate } from 'motion/react';
import { Header } from './Header';
import { Sidebar, SIDEBAR_CONTENT_WIDTH } from './Sidebar';
import { RightSidebar, RIGHT_SIDEBAR_CONTENT_WIDTH } from './RightSidebar';
import { ProjectContextPanel, RightSidebarTabs } from './RightSidebarTabs';
import { ContextPanel } from './ContextPanel';
import { ContextPanelRail } from './ContextPanelRail';
import { ErrorBoundary } from '../ui/ErrorBoundary';
import { CommandPalette } from '../ui/CommandPalette';
import { HelpDialog } from '../ui/HelpDialog';
import { OpenCodeStatusDialog } from '../ui/OpenCodeStatusDialog';
import { SessionSidebar } from '@/components/session/SessionSidebar';
import { AppLinkConfirmDialog } from '@/components/chat/AppLinkConfirmDialog';
import { SessionDialogs } from '@/components/session/SessionDialogs';
import { DiffWorkerProvider } from '@/contexts/DiffWorkerProvider';
import { MultiRunLauncher } from '@/components/multirun';
import { DrawerProvider } from '@/contexts/DrawerContext';

import { useUIStore } from '@/stores/useUIStore';
import { useUpdateStore } from '@/stores/useUpdateStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useDeviceInfo, useTabletLayout } from '@/lib/device';
import { useVisualViewport } from '@/hooks/useVisualViewport';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { lazyWithChunkRecovery } from '@/lib/chunkLoadRecovery';
import { syncSessionSwitcherWithDrawer } from '@/components/layout/mobileLeftDrawerSync';
import { BREAKPOINTS } from '@/lib/device';
import { isCapacitorApp } from '@/lib/platform';
import { useLastSessionRestore } from '@/hooks/useLastSessionRestore';
import { MobileWorkspaceDrawerContent } from './MobileWorkspaceDrawerContent';

import { ChatView } from '@/components/views/ChatView';

// Heavy views loaded on-demand to reduce initial bundle parse time.
const PlanView = lazyWithChunkRecovery(() => import('@/components/views/PlanView').then(m => ({ default: m.PlanView })));
const GitView = lazyWithChunkRecovery(() => import('@/components/views/GitView').then(m => ({ default: m.GitView })));
const DiffView = lazyWithChunkRecovery(() => import('@/components/views/DiffView').then(m => ({ default: m.DiffView })));
const TerminalView = lazyWithChunkRecovery(() => import('@/components/views/TerminalView').then(m => ({ default: m.TerminalView })));
const FilesView = lazyWithChunkRecovery(() => import('@/components/views/FilesView').then(m => ({ default: m.FilesView })));
const DiagramView = lazyWithChunkRecovery(() => import('@/components/views/DiagramView').then(m => ({ default: m.DiagramView })));
const SettingsView = lazyWithChunkRecovery(() => import('@/components/views/SettingsView').then(m => ({ default: m.SettingsView })));
const SettingsWindow = lazyWithChunkRecovery(() => import('@/components/views/SettingsWindow').then(m => ({ default: m.SettingsWindow })));
const ArchiveView = lazyWithChunkRecovery(() => import('@/components/views/ArchiveView').then(m => ({ default: m.ArchiveView })));
const WorktreesView = lazyWithChunkRecovery(() => import('@/components/views/WorktreesView').then(m => ({ default: m.WorktreesView })));
const ScheduledTasksView = lazyWithChunkRecovery(() => import('@/components/session/ScheduledTasksDialog').then(m => ({ default: m.ScheduledTasksDialog })));

// Mobile drawer width as screen percentage
const MOBILE_DRAWER_WIDTH_PERCENT = 100;
const DESKTOP_SIDEBAR_MIN_WIDTH = 280;
const DESKTOP_SIDEBAR_MAX_WIDTH = 500;
const DESKTOP_RIGHT_SIDEBAR_MIN_WIDTH = 360;
const DESKTOP_RIGHT_SIDEBAR_MAX_WIDTH = 860;

export const MainLayout: React.FC = () => {
    const { t } = useI18n();
    const RIGHT_SIDEBAR_AUTO_CLOSE_WIDTH = 1140;
    const RIGHT_SIDEBAR_AUTO_OPEN_WIDTH = 1220;
    const isSidebarOpen = useUIStore((state) => state.isSidebarOpen);
    const isRightSidebarOpen = useUIStore((state) => state.isRightSidebarOpen);
    const setRightSidebarOpen = useUIStore((state) => state.setRightSidebarOpen);
    const activeMainTab = useUIStore((state) => state.activeMainTab);
    const setIsMobile = useUIStore((state) => state.setIsMobile);
    const isSessionSwitcherOpen = useUIStore((state) => state.isSessionSwitcherOpen);
    const isSettingsDialogOpen = useUIStore((state) => state.isSettingsDialogOpen);
    const setSettingsDialogOpen = useUIStore((state) => state.setSettingsDialogOpen);
    const isMultiRunLauncherOpen = useUIStore((state) => state.isMultiRunLauncherOpen);
    const setMultiRunLauncherOpen = useUIStore((state) => state.setMultiRunLauncherOpen);
    const multiRunLauncherPrefillPrompt = useUIStore((state) => state.multiRunLauncherPrefillPrompt);
    const multiRunEnabled = useUIStore((state) => state.multiRunEnabled);
    const isScheduledTasksViewOpen = useUIStore((state) => state.isScheduledTasksDialogOpen);
    const isArchivePageOpen = useUIStore((state) => state.isArchivePageOpen);
    const worktreesPageProjectId = useUIStore((state) => state.worktreesPageProjectId);
    const closeMainSurfaces = useUIStore((state) => state.closeMainSurfaces);
    const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
    const previousSessionIdRef = React.useRef(currentSessionId);

    React.useEffect(() => {
      if (previousSessionIdRef.current === currentSessionId) return;
      previousSessionIdRef.current = currentSessionId;
      closeMainSurfaces();
    }, [closeMainSurfaces, currentSessionId]);

    const { isMobile, screenWidth } = useDeviceInfo();
    const visualViewport = useVisualViewport();
    const sidebarWidth = useUIStore((state) => state.sidebarWidth);
    const rightSidebarWidth = useUIStore((state) => state.rightSidebarWidth);
    const setSidebarOpen = useUIStore((state) => state.setSidebarOpen);
    const rightSidebarAutoClosedRef = React.useRef(false);

    // Tablet split layout is a live SIZE CLASS (not an iPad identity check), so
    // Android tablets and foldables are covered by the same branch as iPad. The
    // short viewport side >= sw600dp earns the persistent shared SessionSidebar;
    // a fold is just a resize, so folding under the threshold drops back to the
    // phone drawers. `roomyForPanels` (landscape + >=1000px) captures the old
    // ipadLandscape signal without a separate orientation subscriber.
    const tabletLayout = useTabletLayout();
    const useTabletSplitLayout = tabletLayout.enabled
      && (screenWidth >= BREAKPOINTS.md || tabletLayout.roomyForPanels);
    const useMobileDrawers = isMobile && !useTabletSplitLayout;
    useLastSessionRestore(useMobileDrawers && isCapacitorApp());

    React.useEffect(() => {
      if (useTabletSplitLayout) {
        setSidebarOpen(true);
      }
    }, [setSidebarOpen, useTabletSplitLayout]);

    // Mobile drawer state
    const [mobileLeftDrawerOpen, setMobileLeftDrawerOpen] = React.useState(false);
    const [hasMountedLeftSidebar, setHasMountedLeftSidebar] = React.useState(false);
    const [hasMountedRightDrawer, setHasMountedRightDrawer] = React.useState(false);
    const mobileRightDrawerOpenRef = React.useRef(false);
    const initialDrawerWidthRef = React.useRef(typeof window === 'undefined' ? 0 : window.innerWidth);

    const setLeftDrawerOpen = React.useCallback((open: boolean) => {
        if (open) setHasMountedLeftSidebar(true);
        setMobileLeftDrawerOpen(open);
        syncSessionSwitcherWithDrawer(open);
    }, []);

    // Left drawer motion value
    const leftDrawerX = useMotionValue(-initialDrawerWidthRef.current);
    const leftDrawerWidth = useRef(0);

    // Right drawer motion value
    const rightDrawerX = useMotionValue(initialDrawerWidthRef.current);
    const rightDrawerWidth = useRef(0);

    // Compute drawer width
    useEffect(() => {
        if (useMobileDrawers) {
            leftDrawerWidth.current = window.innerWidth;
            rightDrawerWidth.current = window.innerWidth;
        }
    }, [useMobileDrawers]);

    // Sync left drawer state and motion value
    useEffect(() => {
        if (!useMobileDrawers) return;
        const targetX = mobileLeftDrawerOpen ? 0 : -leftDrawerWidth.current;
        animate(leftDrawerX, targetX, {
            type: "spring",
            stiffness: 400,
            damping: 35,
            mass: 0.8
        });
    }, [mobileLeftDrawerOpen, useMobileDrawers, leftDrawerX]);

    // Sync right drawer state and motion value
    useEffect(() => {
        if (!useMobileDrawers) return;
        mobileRightDrawerOpenRef.current = isRightSidebarOpen;
        if (isRightSidebarOpen) setHasMountedRightDrawer(true);
        const targetX = isRightSidebarOpen ? 0 : rightDrawerWidth.current;
        animate(rightDrawerX, targetX, {
            type: "spring",
            stiffness: 400,
            damping: 35,
            mass: 0.8
        });
    }, [useMobileDrawers, isRightSidebarOpen, rightDrawerX]);

    // Sync session switcher → left drawer (drawer → switcher goes through setLeftDrawerOpen)
    useEffect(() => {
        if (useMobileDrawers) {
            if (isSessionSwitcherOpen) setHasMountedLeftSidebar(true);
            setMobileLeftDrawerOpen(isSessionSwitcherOpen);
        }
    }, [isSessionSwitcherOpen, useMobileDrawers]);

    // Ensure mobile drawers are closed when opening full-screen settings
    useEffect(() => {
        if (!useMobileDrawers || !isSettingsDialogOpen) {
            return;
        }

        setLeftDrawerOpen(false);
        if (isRightSidebarOpen) {
            setRightSidebarOpen(false);
        }
    }, [useMobileDrawers, isSettingsDialogOpen, isRightSidebarOpen, setLeftDrawerOpen, setRightSidebarOpen]);

    // Sync right drawer and git sidebar state
    useEffect(() => {
        if (useMobileDrawers) {
            mobileRightDrawerOpenRef.current = isRightSidebarOpen;
        }
    }, [isRightSidebarOpen, useMobileDrawers]);

    // Trigger initial update check shortly after mount, then repeat using server-suggested cadence.
    const checkForUpdates = useUpdateStore((state) => state.checkForUpdates);
    React.useEffect(() => {
        const initialDelayMs = 3000;
        const defaultIntervalMs = 60 * 60 * 1000;
        const minIntervalMs = 5 * 60 * 1000;
        const maxIntervalMs = 24 * 60 * 60 * 1000;
        let disposed = false;
        let timer: number | null = null;

        const clampIntervalMs = (seconds: number): number => {
            const ms = Math.round(seconds * 1000);
            return Math.max(minIntervalMs, Math.min(maxIntervalMs, ms));
        };

        const scheduleNext = (delayMs: number) => {
            if (disposed) return;
            timer = window.setTimeout(async () => {
                const suggestedSec = await checkForUpdates();
                const nextDelay = typeof suggestedSec === 'number' && Number.isFinite(suggestedSec)
                    ? clampIntervalMs(suggestedSec)
                    : defaultIntervalMs;
                scheduleNext(nextDelay);
            }, delayMs);
        };

        scheduleNext(initialDelayMs);

        return () => {
            disposed = true;
            if (timer !== null) {
                window.clearTimeout(timer);
            }
        };
    }, [checkForUpdates]);

    React.useEffect(() => {
        const previous = useUIStore.getState().isMobile;
        if (previous !== isMobile) {
            setIsMobile(isMobile);
        }
    }, [isMobile, setIsMobile]);

    React.useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        let frameId: number | undefined;

         const handleResponsivePanels = () => {
             const state = useUIStore.getState();
             const width = window.innerWidth;

             if (!isMobile) {
                 const shouldCloseRightSidebar = width < RIGHT_SIDEBAR_AUTO_CLOSE_WIDTH;
                 const canAutoOpenRightSidebar = width >= RIGHT_SIDEBAR_AUTO_OPEN_WIDTH;

                 if (shouldCloseRightSidebar) {
                     if (state.isRightSidebarOpen) {
                         setRightSidebarOpen(false);
                         rightSidebarAutoClosedRef.current = true;
                     }
                 } else if (canAutoOpenRightSidebar && rightSidebarAutoClosedRef.current) {
                     setRightSidebarOpen(true);
                     rightSidebarAutoClosedRef.current = false;
                 }
             }
         };

        const handleResize = () => {
            if (frameId !== undefined) {
                return;
            }

            frameId = window.requestAnimationFrame(() => {
                frameId = undefined;
                handleResponsivePanels();
            });
        };

        handleResponsivePanels();
        window.addEventListener('resize', handleResize);

        return () => {
            window.removeEventListener('resize', handleResize);
            if (frameId !== undefined) {
                window.cancelAnimationFrame(frameId);
            }
        };
    }, [isMobile, setRightSidebarOpen]);

    React.useEffect(() => {
        if (typeof window === 'undefined') {
            return;
        }

        const unsubscribe = useUIStore.subscribe((state, prevState) => {
            const width = window.innerWidth;

            const rightCanAutoOpen = width >= RIGHT_SIDEBAR_AUTO_OPEN_WIDTH;

            if (state.isRightSidebarOpen !== prevState.isRightSidebarOpen && rightCanAutoOpen) {
                rightSidebarAutoClosedRef.current = false;
            }
        });

        return () => {
            unsubscribe();
        };
    }, []);

    const secondaryView = React.useMemo(() => {
        switch (activeMainTab) {
            case 'plan':
                return <React.Suspense fallback={null}><PlanView /></React.Suspense>;
            case 'git':
                return <React.Suspense fallback={null}><GitView /></React.Suspense>;
            case 'diff':
                return <React.Suspense fallback={null}><DiffView /></React.Suspense>;
            case 'terminal':
                return <React.Suspense fallback={null}><TerminalView /></React.Suspense>;
            case 'files':
                return <React.Suspense fallback={null}><FilesView /></React.Suspense>;
            case 'diagram':
                return <React.Suspense fallback={null}><DiagramView /></React.Suspense>;
            case 'context':
                return <ProjectContextPanel />;
            default:
                return null;
        }
    }, [activeMainTab]);

    const isChatActive = activeMainTab === 'chat';
    const isMainSurfaceOpen = (
      (multiRunEnabled && isMultiRunLauncherOpen)
      || isScheduledTasksViewOpen
      || isArchivePageOpen
      || worktreesPageProjectId !== null
    );
    const visibleSidebarWidth = React.useMemo(() => {
        const rawWidth = sidebarWidth || SIDEBAR_CONTENT_WIDTH;
        return Math.min(DESKTOP_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_SIDEBAR_MIN_WIDTH, rawWidth));
    }, [sidebarWidth]);
    const visibleRightSidebarWidth = React.useMemo(() => {
        const rawWidth = rightSidebarWidth || RIGHT_SIDEBAR_CONTENT_WIDTH;
        return Math.min(DESKTOP_RIGHT_SIDEBAR_MAX_WIDTH, Math.max(DESKTOP_RIGHT_SIDEBAR_MIN_WIDTH, rawWidth));
    }, [rightSidebarWidth]);

    return (
        <DiffWorkerProvider>
            <div
                data-page-scroll-lock="true"
                className={cn(
                    'main-content-safe-area',
                    useMobileDrawers ? 'flex flex-col' : 'flex h-[100dvh]',
                    'bg-background'
                )}
                style={(
                  // Capacitor owns keyboard lift via --oc-keyboard-inset. Using
                  // visualViewport.height there double-counts the IME and leaves
                  // a large gap under the composer (unlike DeepSeek-style flush).
                  useMobileDrawers
                  && visualViewport.height > 0
                  && !isCapacitorApp()
                ) ? { height: visualViewport.height } : undefined}
            >
                <CommandPalette />
                <HelpDialog />
                <OpenCodeStatusDialog />
                <SessionDialogs />

                {useMobileDrawers ? (
                <DrawerProvider value={{
                    leftDrawerOpen: mobileLeftDrawerOpen,
                    rightDrawerOpen: isRightSidebarOpen,
                    toggleLeftDrawer: () => {
                        if (isRightSidebarOpen) {
                            setRightSidebarOpen(false);
                        }
                        setLeftDrawerOpen(!mobileLeftDrawerOpen);
                    },
                    toggleRightDrawer: () => {
                        if (mobileLeftDrawerOpen) {
                            setLeftDrawerOpen(false);
                        }
                        setRightSidebarOpen(!isRightSidebarOpen);
                    },
                    leftDrawerX,
                    rightDrawerX,
                    leftDrawerWidth,
                    rightDrawerWidth,
                    setMobileLeftDrawerOpen: setLeftDrawerOpen,
                    setRightSidebarOpen,
                }}>
                    {/* Mobile: header + drawer mode */}
                    {!isSettingsDialogOpen && <Header 
                        onToggleLeftDrawer={() => {
                            if (isRightSidebarOpen) {
                                setRightSidebarOpen(false);
                            }
                            setLeftDrawerOpen(!mobileLeftDrawerOpen);
                        }}
                        onToggleRightDrawer={() => {
                            if (mobileLeftDrawerOpen) {
                                setLeftDrawerOpen(false);
                            }
                            setRightSidebarOpen(!isRightSidebarOpen);
                        }}
                        leftDrawerOpen={mobileLeftDrawerOpen}
                        rightDrawerOpen={isRightSidebarOpen}
                    />}
                    
                    {/* Backdrop */}
                    <motion.button
                        type="button"
                        initial={false}
                        animate={{
                            opacity: mobileLeftDrawerOpen || isRightSidebarOpen ? 1 : 0,
                            pointerEvents: mobileLeftDrawerOpen || isRightSidebarOpen ? 'auto' : 'none',
                        }}
                        className="fixed left-0 right-0 bottom-0 top-[var(--oc-header-height,56px)] z-40 bg-black/50 cursor-default"
                        onClick={() => {
                            setLeftDrawerOpen(false);
                            setRightSidebarOpen(false);
                        }}
                        aria-label={t('mainLayout.mobile.closeDrawerAria')}
                    />
                    
                    {/* Left drawer (Session). No drag="x": framer pan on the
                        aside steals vertical list scroll and pegs mobile CPU. */}
                    <motion.aside
                        style={{
                            width: `${MOBILE_DRAWER_WIDTH_PERCENT}%`,
                            x: leftDrawerX,
                        }}
                        className="fixed left-0 top-[var(--oc-header-height,56px)] z-50 h-[calc(100%-var(--oc-header-height,56px))] bg-background"
                        aria-hidden={!mobileLeftDrawerOpen}
                    >
                        <div
                            data-page-scroll-lock="true"
                            className="h-full overflow-hidden flex bg-[var(--surface-background)] shadow-none drawer-safe-area"
                            style={{ backgroundImage: 'linear-gradient(var(--surface-muted), var(--surface-muted))' }}
                        >
                            <div className="flex-1 min-w-0 overflow-hidden flex flex-col" data-page-scroll-lock="true">
                                {/* Lazy-once keep-alive: avoid remount cost on every open.
                                    Closed drawers stay mounted but inert/hidden; SessionSidebar
                                    gates polls via sidebarActive. */}
                                {hasMountedLeftSidebar ? (
                                  <div
                                    className="flex h-full min-h-0 flex-1 flex-col overflow-hidden"
                                    aria-hidden={!mobileLeftDrawerOpen}
                                    inert={!mobileLeftDrawerOpen || undefined}
                                    style={{
                                      visibility: mobileLeftDrawerOpen ? 'visible' : 'hidden',
                                      contentVisibility: mobileLeftDrawerOpen ? 'visible' : 'hidden',
                                      pointerEvents: mobileLeftDrawerOpen ? 'auto' : 'none',
                                    }}
                                  >
                                    <ErrorBoundary>
                                      <SessionSidebar
                                        mobileVariant
                                        sidebarActive={mobileLeftDrawerOpen}
                                      />
                                    </ErrorBoundary>
                                  </div>
                                ) : null}
                            </div>
                        </div>
                    </motion.aside>
                    
                    {/* Right drawer (Git) — same: animate via motion value only. */}
                    <motion.aside
                        style={{
                            width: `${MOBILE_DRAWER_WIDTH_PERCENT}%`,
                            x: rightDrawerX,
                        }}
                        className="fixed right-0 top-[var(--oc-header-height,56px)] z-50 h-[calc(100%-var(--oc-header-height,56px))] bg-background"
                        aria-hidden={!isRightSidebarOpen}
                    >
                        <div className="h-full overflow-hidden flex flex-col bg-background shadow-none drawer-safe-area" data-page-scroll-lock="true">
                            {hasMountedRightDrawer ? (
                              <MobileWorkspaceDrawerContent
                                open={isRightSidebarOpen}
                                onClose={() => setRightSidebarOpen(false)}
                              />
                            ) : null}
                        </div>
                    </motion.aside>
                    
                    {/* Main content area (fixed). min-h-0 so Capacitor keyboard shell
                        height (100dvh - IME) can shrink this flex child; otherwise
                        min-height:auto keeps the chat column tall and clips the composer. */}
                    <div
                        data-page-scroll-lock="true"
                        className={cn(
                            'flex min-h-0 flex-1 overflow-hidden relative',
                            isSettingsDialogOpen && 'hidden'
                        )}
                    >
                        <main className="relative h-full min-h-0 w-full overflow-hidden bg-background" data-page-scroll-lock="true">
                            <div className={cn('absolute inset-0', (!isChatActive || isMainSurfaceOpen) && 'invisible')}>
                                <ErrorBoundary><ChatView /></ErrorBoundary>
                            </div>
                            {secondaryView && !isMainSurfaceOpen && (
                                <div className="absolute inset-0">
                                    <ErrorBoundary>{secondaryView}</ErrorBoundary>
                                </div>
                            )}
                            {multiRunEnabled && isMultiRunLauncherOpen && (
                                <div className="absolute inset-0 z-10 bg-background">
                                    <ErrorBoundary>
                                        <MultiRunLauncher
                                            initialPrompt={multiRunLauncherPrefillPrompt}
                                            onCreated={() => setMultiRunLauncherOpen(false)}
                                            onCancel={() => setMultiRunLauncherOpen(false)}
                                        />
                                    </ErrorBoundary>
                                </div>
                            )}
                            {isScheduledTasksViewOpen && (
                                <ErrorBoundary>
                                    <React.Suspense fallback={null}><ScheduledTasksView /></React.Suspense>
                                </ErrorBoundary>
                            )}
                            {isArchivePageOpen && (
                                <ErrorBoundary>
                                    <React.Suspense fallback={null}><ArchiveView /></React.Suspense>
                                </ErrorBoundary>
                            )}
                            {worktreesPageProjectId !== null && (
                                <ErrorBoundary>
                                    <React.Suspense fallback={null}><WorktreesView /></React.Suspense>
                                </ErrorBoundary>
                            )}
                        </main>
                    </div>

                    {/* Mobile settings: full screen */}
                    {isSettingsDialogOpen && (
                        <div
                            className="absolute inset-0 z-10 bg-background"
                            style={{ paddingTop: 'var(--oc-safe-area-top, 0px)' }}
                        >
                            <ErrorBoundary>
                                <React.Suspense fallback={null}>
                                    <SettingsView onClose={() => setSettingsDialogOpen(false)} />
                                </React.Suspense>
                            </ErrorBoundary>
                        </div>
                    )}
                </DrawerProvider>
            ) : (
                <>
                    {/* Desktop: full-width Header above [Sidebar | chat-frame | RightSidebar] row */}
                    <div className="flex flex-1 flex-col overflow-hidden">
                        <Header />
                        <div className="relative flex flex-1 min-h-0 overflow-hidden bg-sidebar" data-page-scroll-lock="true">
                            <div
                                aria-hidden
                                className="pointer-events-none absolute top-0 z-0 bg-sidebar transition-[left,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                                style={{
                                    left: `${isSidebarOpen ? visibleSidebarWidth : 0}px`,
                                    opacity: isSidebarOpen ? 1 : 0,
                                    width: '10px',
                                    height: '10px',
                                    WebkitMaskImage: 'radial-gradient(circle at 100% 100%, transparent calc(10px - 1px), black 10px)',
                                    maskImage: 'radial-gradient(circle at 100% 100%, transparent calc(10px - 1px), black 10px)',
                                }}
                            />
                            <div
                                aria-hidden
                                className="pointer-events-none absolute bottom-0 z-0 bg-sidebar transition-[left,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                                style={{
                                    left: `${isSidebarOpen ? visibleSidebarWidth : 0}px`,
                                    opacity: isSidebarOpen ? 1 : 0,
                                    width: '10px',
                                    height: '10px',
                                    WebkitMaskImage: 'radial-gradient(circle at 100% 0%, transparent calc(10px - 1px), black 10px)',
                                    maskImage: 'radial-gradient(circle at 100% 0%, transparent calc(10px - 1px), black 10px)',
                                }}
                            />
                            <div
                                aria-hidden
                                className="pointer-events-none absolute top-0 z-0 bg-sidebar transition-[right,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                                style={{
                                    right: `${isRightSidebarOpen ? visibleRightSidebarWidth : 0}px`,
                                    opacity: isRightSidebarOpen ? 1 : 0,
                                    width: '10px',
                                    height: '10px',
                                    WebkitMaskImage: 'radial-gradient(circle at 0 100%, transparent calc(10px - 1px), black 10px)',
                                    maskImage: 'radial-gradient(circle at 0 100%, transparent calc(10px - 1px), black 10px)',
                                }}
                            />
                            <div
                                aria-hidden
                                className="pointer-events-none absolute bottom-0 z-0 bg-sidebar transition-[right,opacity] duration-200 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none"
                                style={{
                                    right: `${isRightSidebarOpen ? visibleRightSidebarWidth : 0}px`,
                                    opacity: isRightSidebarOpen ? 1 : 0,
                                    width: '10px',
                                    height: '10px',
                                    WebkitMaskImage: 'radial-gradient(circle at 0 0, transparent calc(10px - 1px), black 10px)',
                                    maskImage: 'radial-gradient(circle at 0 0, transparent calc(10px - 1px), black 10px)',
                                }}
                            />
                            <Sidebar
                                isOpen={isSidebarOpen}
                                isMobile={false}
                                className="border-0"
                            >
                                <SessionSidebar />
                            </Sidebar>
                            <div className={cn(
                                'relative flex flex-1 min-w-0 flex-col overflow-hidden',
                                'bg-background',
                                'border border-border/50 rounded-[10px]',
                                !isSidebarOpen && 'border-l-transparent',
                                !isRightSidebarOpen && 'border-r-transparent'
                            )} data-page-scroll-lock="true">
                                <div className="flex flex-1 min-h-0 overflow-hidden" data-page-scroll-lock="true">
                                    <div className="relative flex flex-1 min-h-0 min-w-0 overflow-hidden" data-page-scroll-lock="true">
                                        <main className="flex-1 overflow-hidden bg-background relative" data-page-scroll-lock="true">
                                            <div className={cn('absolute inset-0', (!isChatActive || isMainSurfaceOpen) && 'invisible')}>
                                                <ErrorBoundary><ChatView /></ErrorBoundary>
                                            </div>
                                            {secondaryView && !isMainSurfaceOpen && (
                                                <div className="absolute inset-0">
                                                    <ErrorBoundary>{secondaryView}</ErrorBoundary>
                                                </div>
                                            )}
                                            {multiRunEnabled && isMultiRunLauncherOpen && (
                                                <div className="absolute inset-0 z-10 bg-background">
                                                    <ErrorBoundary>
                                                        <MultiRunLauncher
                                                            initialPrompt={multiRunLauncherPrefillPrompt}
                                                            onCreated={() => setMultiRunLauncherOpen(false)}
                                                            onCancel={() => setMultiRunLauncherOpen(false)}
                                                        />
                                                    </ErrorBoundary>
                                                </div>
                                            )}
                                            {isScheduledTasksViewOpen && (
                                                <ErrorBoundary>
                                                    <React.Suspense fallback={null}><ScheduledTasksView /></React.Suspense>
                                                </ErrorBoundary>
                                            )}
                                            {isArchivePageOpen && (
                                                <ErrorBoundary>
                                                    <React.Suspense fallback={null}><ArchiveView /></React.Suspense>
                                                </ErrorBoundary>
                                            )}
                                            {worktreesPageProjectId !== null && (
                                                <ErrorBoundary>
                                                    <React.Suspense fallback={null}><WorktreesView /></React.Suspense>
                                                </ErrorBoundary>
                                            )}
                                        </main>
                                        {!isMainSurfaceOpen ? (
                                          <>
                                            <ContextPanel />
                                            <ErrorBoundary><ContextPanelRail /></ErrorBoundary>
                                          </>
                                        ) : null}
                                    </div>
                                </div>
                            </div>
                            <RightSidebar
                                isOpen={isRightSidebarOpen}
                                className="border-0"
                            >
                                <ErrorBoundary><RightSidebarTabs /></ErrorBoundary>
                            </RightSidebar>
                        </div>
                    </div>

                    {/* Desktop settings: windowed dialog with blur */}
                    <React.Suspense fallback={null}>
                        <SettingsWindow
                            open={isSettingsDialogOpen}
                            onOpenChange={setSettingsDialogOpen}
                        />
                    </React.Suspense>
                </>
            )}

            <AppLinkConfirmDialog />

        </div>
    </DiffWorkerProvider>
    );
};
