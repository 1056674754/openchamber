import React from 'react';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Icon } from "@/components/icon/Icon";
import {
  RiAddLine,
  RiArchiveLine,
  RiArrowDownSLine,
  RiArrowRightSLine,
  RiChat4Line,
  RiCheckLine,
  RiCloseLine,
  RiDeleteBinLine,
  RiDownloadLine,
  RiErrorWarningLine,
  RiFileCopyLine,
  RiFolderLine,
  RiLinkUnlinkM,
  RiPencilAiLine,
  RiPushpinLine,
  RiRefreshLine,
  RiShare2Line,
  RiShieldLine,
  RiComputerLine,
  RiUnpinLine,
  RiGitBranchLine,
  RiWindowLine,
  RiSparklingLine,
    </span>
  );

  const rowKind = resolveSessionRowKind({ isPinned: isPinnedSession, isSubtask: isSubtaskSession });
  const leadingState = isGlobalPinnedRootRow
    ? resolveGlobalPinnedLeadingState({
      hasChildren: hasChildrenChevron,
      hasSpinner: shouldShowSpinner,
      hasUnread: showUnreadStatus,
    })
    : resolveLeadingState({
      rowKind,
      hasChildren: hasChildrenChevron,
      hasSpinner: shouldShowSpinner,
      hasUnread: showUnreadStatus,
    });

  const renderChevron = (mode: 'normal' | 'overlay') => (
    <span
      role="button"
      tabIndex={0}
      onPointerDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onMouseDown={(e) => {
        e.preventDefault();
        e.stopPropagation();
      }}
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleParent(session.id);
      }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault(); e.stopPropagation(); toggleParent(session.id);
        }
      }}
      className={cn(
        mode === 'overlay'
          ? 'absolute inset-0 inline-flex h-4 w-3.5 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 opacity-0 group-hover:opacity-100 group-hover:pointer-events-auto group-focus-within:opacity-100 group-focus-within:pointer-events-auto'
          : 'pointer-events-auto inline-flex h-4 w-3.5 flex-shrink-0 items-center justify-center rounded-md text-muted-foreground hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
      )}
      aria-label={isExpanded ? t('sessions.sidebar.session.subsessions.collapse') : t('sessions.sidebar.session.subsessions.expand')}
    >
      {isExpanded ? <Icon name="arrow-down-s" className="h-3 w-3" /> : <Icon name="arrow-right-s" className="h-3 w-3" />}
    </span>
  );

  const renderPin = () => (
    <Icon name="pushpin"
      className={cn('h-3.5 w-3.5 flex-shrink-0', isStreaming ? 'text-primary animate-busy-pulse' : showUnreadStatus ? 'text-[var(--status-info)]' : 'text-foreground')}
      aria-label={isGloballyPinned ? t('sessions.sidebar.session.status.pinnedGlobal') : t('sessions.sidebar.session.status.pinned')}
     />
  );

  const renderLeadingSlot = (slot: LeadingSlotValue) => {
    if (slot === 'none') return null;
    if (slot === 'spinner') return renderSpinner();
    if (slot === 'unread') return renderUnreadDot();
    if (slot === 'spinner-unread') return renderAlternating();
    if (slot === 'pin') return renderPin();
    if (slot === 'chevron') return renderChevron('normal');
    return (
      <span className="relative inline-flex h-4 w-3.5 flex-shrink-0 items-center justify-center group-hover:[&>*:first-child]:opacity-0 group-focus-within:[&>*:first-child]:opacity-0">
        {renderPin()}
        {renderChevron('overlay')}
      </span>
    );
  };

  const slot1Content = renderLeadingSlot(leadingState.slot1);
  const slot2Content = renderLeadingSlot(leadingState.slot2);
  const rowIndentPx = depth > 0
    ? (isGlobalPinnedContext ? depth * 16 + GLOBAL_PINNED_CHILD_INDENT : depth * 16 + 4)
    : 0;
  const nestedLeadingSlotsStyle = depth > 0
    ? { left: `${rowIndentPx - 34}px` }
    : undefined;

  const projectLeadingStatusSlots = slot1Content || slot2Content ? (
    <div className="pointer-events-none absolute -left-7 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5" style={nestedLeadingSlotsStyle}>
      <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {slot1Content}
      </span>
      <span className="inline-flex h-4 w-3.5 flex-shrink-0 items-center justify-center">
        {slot2Content}
      </span>
    </div>
  ) : null;

  const globalPinnedChildLeadingSlots = isGlobalPinnedContext && !isGlobalPinnedRootRow && (slot1Content || slot2Content) ? (
    <div className="pointer-events-none absolute left-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5" style={nestedLeadingSlotsStyle}>
      <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
        {slot1Content}
      </span>
      <span className="inline-flex h-4 w-3.5 flex-shrink-0 items-center justify-center">
        {slot2Content}
      </span>
    </div>
  ) : null;

  const globalPinnedLeadingSlots = isGlobalPinnedContext && isGlobalPinnedRootRow ? (
    <div className="pointer-events-none flex flex-shrink-0 items-center gap-1.5">
      <span className="inline-flex h-3.5 w-3.5 flex-shrink-0 items-center justify-center">
        {slot1Content}
      </span>
      {slot2Content ? (
        <span className="inline-flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {slot2Content}
        </span>
      ) : null}
    </div>
  ) : null;

  const streamingIndicator = isZombie
    ? <Icon name="error-warning" className="h-4 w-4 text-status-warning" />
    : null;

  const handleMenuOpenChange = (open: boolean) => {
    setOpenSidebarMenuKey(open ? menuInstanceKey : null);
  };

  const handleRowSelect = (event?: React.MouseEvent<HTMLButtonElement>) => {
    if (suppressNextSelectRef.current) {
      suppressNextSelectRef.current = false;
      return;
    }
    if (selectionModeEnabled) {
      event?.preventDefault();
      event?.stopPropagation();
      if (event?.shiftKey) {
        const rows = typeof document !== 'undefined'
          ? Array.from(document.querySelectorAll<HTMLElement>('[data-session-row]'))
          : [];
        const orderedIds = rows
          .map((el) => el.getAttribute('data-session-row'))
          .filter((id): id is string => typeof id === 'string' && id.length > 0);
        const currentAnchor = useSessionMultiSelectStore.getState().anchorId;
        const descendantsById = new Map<string, string[]>();
        descendantsById.set(session.id, collectNodeDescendantIds(node));
        setRowRange(currentAnchor, session.id, orderedIds, sessionDirectory ?? null, descendantsById);
        return;
      }
      toggleRowSelected(session.id, sessionDirectory ?? null, collectNodeDescendantIds(node));
      return;
    }
    handleSessionSelect(session.id, sessionDirectory, isMissingDirectory, projectId);
  };

  const handleRowMouseDown = (event: React.MouseEvent<HTMLButtonElement>) => {
    if (event.button === 2 || (event.button === 0 && event.ctrlKey && !selectionModeEnabled)) {
      suppressNextSelectRef.current = true;
    }
  };
  const handleRowPointerDown = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (mobileVariant && event.pointerType === 'touch') {
      setIsTouchPressed(true);
    }
  };
  const handleRowPointerEnd = (event: React.PointerEvent<HTMLButtonElement>) => {
    if (mobileVariant && event.pointerType === 'touch') {
      setIsTouchPressed(false);
    }
  };

  const sessionMenuContent = (
    <DropdownMenuContent align="end" className="min-w-[180px]" onCloseAutoFocus={(event) => { if (renamingFolderId) event.preventDefault(); }}>
      <DropdownMenuItem
        onClick={() => {
          setEditingId(session.id);
          setEditTitle(sessionTitle);
        }}
        className="[&>svg]:mr-1"
      >
        <Icon name="pencil-ai" className="mr-1 h-4 w-4" />
        {t('sessions.sidebar.session.menu.rename')}
      </DropdownMenuItem>
      {onRegenerateTitle ? (
        <DropdownMenuItem
          onClick={() => {
            setOpenSidebarMenuKey(null);
            onRegenerateTitle(session.id, sessionTitle);
          }}
          className="[&>svg]:mr-1"
        >
          <Icon name="sparkling" className="mr-1 h-4 w-4"  />
          {t('sessions.sidebar.session.menu.regenerateTitle')}
        </DropdownMenuItem>
      ) : null}
      {isGloballyPinned ? (
        <DropdownMenuItem onClick={() => togglePinnedSession(session.id, 'global')} className="[&>svg]:mr-1">
          <Icon name="unpin" className="mr-1 h-4 w-4"  />
          {t('sessions.sidebar.session.menu.unpinGlobal')}
        </DropdownMenuItem>
      ) : isPinnedSession ? (
        <DropdownMenuItem onClick={() => togglePinnedSession(session.id, groupDirectory ?? '')} className="[&>svg]:mr-1">
          <Icon name="unpin" className="mr-1 h-4 w-4"  />
          {t('sessions.sidebar.session.menu.unpin')}
        </DropdownMenuItem>
      ) : (
        <>
          <DropdownMenuItem onClick={() => togglePinnedSession(session.id, 'global')} className="[&>svg]:mr-1">
            <Icon name="pushpin" className="mr-1 h-4 w-4"  />
            {t('sessions.sidebar.session.menu.pinGlobal')}
          </DropdownMenuItem>
          {groupDirectory ? (
            <DropdownMenuItem onClick={() => togglePinnedSession(session.id, groupDirectory)} className="[&>svg]:mr-1">
              <Icon name="pushpin" className="mr-1 h-4 w-4"  />
              {t('sessions.sidebar.session.menu.pinToProject')}
            </DropdownMenuItem>
          ) : null}
        </>
      )}
      {!resolvedSession.share ? (
        <DropdownMenuItem onClick={() => handleShareSession(resolvedSession)} className="[&>svg]:mr-1">
          <Icon name="share-2" className="mr-1 h-4 w-4" />
          {t('sessions.sidebar.session.menu.share')}
        </DropdownMenuItem>
      ) : (
        <>
          <DropdownMenuItem onClick={() => { if (resolvedSession.share?.url) handleCopyShareUrl(resolvedSession.share.url, session.id); }} className="[&>svg]:mr-1">
            {copiedSessionId === session.id
              ? <><Icon name="check" className="mr-1 h-4 w-4"  style={{ color: 'var(--status-success)' }}/>{t('sessions.sidebar.session.menu.copied')}</>
              : <><Icon name="file-copy" className="mr-1 h-4 w-4" />{t('sessions.sidebar.session.menu.copyLink')}</>}
          </DropdownMenuItem>
          <DropdownMenuItem onClick={() => handleUnshareSession(session.id)} className="[&>svg]:mr-1">
            <Icon name="link-unlink-m" className="mr-1 h-4 w-4" />
            {t('sessions.sidebar.session.menu.unshare')}
          </DropdownMenuItem>
        </>
      )}
      <DropdownMenuItem onClick={() => { void handleExportSession(); }} className="[&>svg]:mr-1">
        <Icon name="download" className="mr-1 h-4 w-4" />
        {t('sessions.sidebar.session.menu.exportMarkdown')}
      </DropdownMenuItem>
      <DropdownMenuItem
        onClick={() => { void sync.syncSession(session.id, true); }}
        className="[&>svg]:mr-1"
      >
        <Icon name="refresh" className="mr-1 h-4 w-4"  />
        {t('sessions.sidebar.session.menu.refresh')}
      </DropdownMenuItem>

      {sessionDirectory && !archivedBucket ? (() => {
        const scopeFolders = getFoldersForScope(sessionDirectory);
        const currentFolderId = getSessionFolderId(sessionDirectory, session.id);
        return (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuSub>
              <DropdownMenuSubTrigger className="[&>svg]:mr-1"><Icon name="folder" className="h-4 w-4" />{t('sessions.sidebar.folders.moveToFolder')}</DropdownMenuSubTrigger>
              <DropdownMenuSubContent className="min-w-[180px]">
                {scopeFolders.length === 0 ? (
                  <DropdownMenuItem disabled className="text-muted-foreground">{t('sessions.sidebar.folders.none')}</DropdownMenuItem>
                ) : (
                  scopeFolders.map((folder) => (
                    <DropdownMenuItem key={folder.id} onClick={() => { if (currentFolderId === folder.id) removeSessionFromFolder(sessionDirectory, session.id); else addSessionToFolder(sessionDirectory, folder.id, session.id); }}>
                      <span className="flex-1 truncate">{folder.name}</span>
                      {currentFolderId === folder.id ? <Icon name="check" className="ml-2 h-3.5 w-3.5 text-primary flex-shrink-0" /> : null}
                    </DropdownMenuItem>
                  ))
                )}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => { const newFolder = createFolderAndStartRename(sessionDirectory); if (!newFolder) return; addSessionToFolder(sessionDirectory, newFolder.id, session.id); }}>
                  <Icon name="add" className="mr-1 h-4 w-4" />
                  {t('sessions.sidebar.folders.newFolderEllipsis')}
                </DropdownMenuItem>
                {currentFolderId ? (
                  <DropdownMenuItem onClick={() => { removeSessionFromFolder(sessionDirectory, session.id); }} className="text-destructive focus:text-destructive">
                    <Icon name="close" className="mr-1 h-4 w-4" />
                    {t('sessions.sidebar.folders.removeFromFolder')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuSubContent>
            </DropdownMenuSub>
          </>
        );
      })() : null}

      {!isVSCode ? (
        <DropdownMenuItem
          disabled={!sessionDirectory}
          onClick={() => {
            if (!sessionDirectory) return;
            openContextPanelTab(sessionDirectory, {
              mode: 'chat',
              dedupeKey: `session:${session.id}`,
              label: sessionTitle,
            });
          }}
          className="[&>svg]:mr-1"
        >
          <Icon name="chat-4" className="mr-1 h-4 w-4" />
          <span className="truncate">{t('sessions.sidebar.session.menu.openInSidePanel')}</span>
          <span className="shrink-0 typography-micro px-1 rounded leading-none pb-px text-[var(--status-warning)] bg-[var(--status-warning)]/10">{t('sessions.sidebar.session.menu.betaBadge')}</span>
        </DropdownMenuItem>
      ) : null}

      {isElectron ? (
        <DropdownMenuItem
          disabled={!sessionDirectory}
          onClick={handleOpenMiniChatWindow}
          className="[&>svg]:mr-1"
        >
          <Icon name="window" className="mr-1 h-4 w-4" />
          <span className="truncate">{t('sessions.sidebar.session.menu.openMiniChatWindow')}</span>
        </DropdownMenuItem>
      ) : null}

      {!archivedBucket ? (
        <>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            onClick={() => { handleDeleteSession(session, { archivedBucket: true }); }}
            className="[&>svg]:mr-1 text-destructive focus:text-destructive"
          >
            <Icon name="delete-bin" className="mr-1 h-4 w-4"  />
            {t('sessions.sidebar.session.menu.delete')}
          </DropdownMenuItem>
        </>
      ) : null}

    </DropdownMenuContent>
  );

  return (
    <React.Fragment key={session.id}>
      <DraggableSessionRow sessionId={session.id} sessionDirectory={sessionDirectory ?? null} sessionTitle={sessionTitle}>
        <div
          data-session-row={session.id}
          data-session-scope={sessionDirectory ?? ''}
          data-session-archived={archivedBucket ? '1' : '0'}
          className={cn(
            'group relative my-0.5 flex items-center rounded-sm py-1',
            isGlobalPinnedRootRow ? 'px-0.5' : 'px-1.5',
            isGlobalPinnedRootRow && 'gap-1.5',
            isMissingDirectory ? 'opacity-75' : '',
            isRowSelected && 'bg-primary/15',
          )}
          style={depth > 0 ? { paddingLeft: `${rowIndentPx}px` } : undefined}
          onContextMenu={!mobileVariant ? (e) => {
            e.preventDefault();
            setMenuPosition({ x: e.clientX, y: e.clientY });
            setOpenSidebarMenuKey(menuInstanceKey);
          } : undefined}
        >
          {isGlobalPinnedRootRow ? globalPinnedLeadingSlots : globalPinnedChildLeadingSlots ?? projectLeadingStatusSlots}
          <div className="flex min-w-0 flex-1 items-center">
            {isMinimalMode ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    type="button"
                    disabled={isMissingDirectory}
                    onPointerDown={handleRowPointerDown}
                    onPointerUp={handleRowPointerEnd}
                    onPointerCancel={handleRowPointerEnd}
                    onMouseDown={handleRowMouseDown}
                    onClick={(event) => handleRowSelect(event)}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      handleSessionDoubleClick();
                    }}
                    className={cn(
                      'flex min-w-0 flex-1 cursor-pointer flex-col gap-0 overflow-hidden rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-foreground select-none disabled:cursor-not-allowed',
                      isTouchPressed && 'bg-interactive-hover/70',
                      alwaysShowActions ? 'pr-7' : null,
                    )}
                    >
                    <div className={cn('flex w-full items-center min-w-0 flex-1 overflow-hidden', isGlobalPinnedContext ? 'gap-1.5' : 'gap-0.5')}>
                      <div
                        className={cn('block min-w-0 flex-1 truncate typography-ui-label font-normal', isActive ? 'text-primary' : 'text-foreground')}
                      >
                        {renderHighlightedText(sessionTitle, normalizedSessionSearchQuery)}
                      </div>
                      {remoteIndicator}
                      {alwaysShowActions ? <span className="ml-2 flex-shrink-0 text-[0.72rem] text-muted-foreground/75">{sessionCompactUpdatedLabel}</span> : null}
                      {!alwaysShowActions ? (
                        <div className="relative ml-1 flex h-4 min-w-4 flex-shrink-0 items-center justify-end">
                          <span className={cn(
                            'whitespace-nowrap text-right text-[0.72rem] text-muted-foreground/75 transition-opacity duration-150',
                            isMenuOpen
                              ? 'opacity-0'
                              : hideOnHoverClass,
                          )}>
                            {sessionCompactUpdatedLabel}
                          </span>
                        </div>
                      ) : null}
                      {pendingPermissionCount > 0 ? (
                        <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1 py-0.5 text-[0.7rem] text-destructive flex-shrink-0" title={t('sessions.sidebar.session.status.permissionRequired')} aria-label={t('sessions.sidebar.session.status.permissionRequired')}>
                          <Icon name="shield" className="h-3 w-3" />
                          <span className="leading-none">{pendingPermissionCount}</span>
                        </span>
                      ) : null}
                    </div>
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" sideOffset={8} className="max-w-xs text-left">
                  <div className="flex flex-col gap-1 text-left text-xs">
                    <div className={cn('flex items-center gap-3 text-left text-muted-foreground', secondaryMeta?.projectLabel ? 'justify-between' : 'justify-start')}>
                      {secondaryMeta?.projectLabel ? <div className="min-w-0 truncate">{secondaryMeta.projectLabel}</div> : null}
                      <div className="flex-shrink-0">{sessionUpdatedLabel}</div>
                    </div>
                    {secondaryMeta?.branchLabel || sessionDiffStats ? (
                      <div className={cn('flex items-center gap-3 text-left text-muted-foreground', secondaryMeta?.branchLabel ? 'justify-between' : 'justify-start')}>
                        {secondaryMeta?.branchLabel ? (
                          <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                            <span className="inline-flex min-w-0 items-center gap-0.5"><Icon name="git-branch" className="h-3 w-3 flex-shrink-0" /><span className="truncate">{secondaryMeta.branchLabel}</span></span>
                          </div>
                        ) : null}
                        {sessionDiffStats ? <span className="flex flex-shrink-0 items-center gap-0.5"><span className="text-status-success">+{sessionDiffStats.additions}</span><span className="text-status-error">-{sessionDiffStats.deletions}</span></span> : null}
                      </div>
                    ) : null}
                  </div>
                </TooltipContent>
              </Tooltip>
            ) : (
              <button
                type="button"
                disabled={isMissingDirectory}
                onPointerDown={handleRowPointerDown}
                onPointerUp={handleRowPointerEnd}
                onPointerCancel={handleRowPointerEnd}
                onMouseDown={handleRowMouseDown}
                onClick={(event) => handleRowSelect(event)}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  handleSessionDoubleClick();
                }}
                className={cn(
                  'flex min-w-0 flex-1 cursor-pointer flex-col gap-0 overflow-hidden rounded-sm text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50 text-foreground select-none disabled:cursor-not-allowed',
                  isTouchPressed && 'bg-interactive-hover/70',
                  alwaysShowActions ? 'pr-7' : null,
                )}
              >
                  <div className={cn('flex w-full items-center min-w-0 flex-1 overflow-hidden', isGlobalPinnedContext ? 'gap-1.5' : 'gap-0.5')}>
                  <div
                    className={cn('block min-w-0 flex-1 truncate typography-ui-label font-normal', isActive ? 'text-primary' : 'text-foreground')}
                  >
                    {renderHighlightedText(sessionTitle, normalizedSessionSearchQuery)}
                  </div>
                  {remoteIndicator}
                  {pendingPermissionCount > 0 ? (
                    <span className="inline-flex items-center gap-1 rounded bg-destructive/10 px-1 py-0.5 text-[0.7rem] text-destructive flex-shrink-0" title={t('sessions.sidebar.session.status.permissionRequired')} aria-label={t('sessions.sidebar.session.status.permissionRequired')}>
                      <Icon name="shield" className="h-3 w-3"  />
                      <span className="leading-none">{pendingPermissionCount}</span>
                    </span>
                  ) : null}
                </div>

                {!isMinimalMode ? (
                  <div className="flex items-center justify-between gap-3 text-muted-foreground/60 min-w-0 overflow-hidden leading-tight" style={{ fontSize: 'calc(var(--text-ui-label) * 0.85)' }}>
                    <div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
                      <span className="flex-shrink-0">{sessionUpdatedLabel}</span>
                      {sessionDiffStats ? <span className="flex flex-shrink-0 items-center gap-0 text-[0.92em]"><span className="text-status-success/80">+{sessionDiffStats.additions}</span><span className="text-muted-foreground/60">/</span><span className="text-status-error/65">-{sessionDiffStats.deletions}</span></span> : null}
                      {hasSecondaryProjectLabel ? <span className="truncate">{secondaryMeta?.projectLabel}</span> : null}
                      {hasSecondaryBranchLabel ? <span className="inline-flex min-w-0 items-center gap-0.5"><Icon name="git-branch" className="h-3 w-3 flex-shrink-0 text-muted-foreground/70" /><span className="truncate">{secondaryMeta?.branchLabel}</span></span> : null}
                    </div>
                  </div>
                ) : null}
              </button>
            )}
          </div>

          {streamingIndicator && !mobileVariant ? (
            <div className={cn('absolute top-1/2 -translate-y-1/2 z-10', isMinimalMode ? 'right-0' : 'right-[30px]')}>
              {streamingIndicator}
            </div>
          ) : null}

          <div className={cn(
            'absolute right-0 top-1/2 z-10 flex -translate-y-1/2 items-center gap-0.5 transition-opacity',
            isMenuOpen || archiveConfirming
              ? 'opacity-100'
              : (alwaysShowActions && !isVSCode)
                ? 'opacity-100'
                : cn('opacity-0', revealOnHoverClass),
          )}>
            {/* Context menu uses hidden positioned trigger only — no visible "..." button (removed per project convention, do not re-add) */}
            <button
              type="button"
              className={cn(
                'inline-flex h-5 w-5 items-center justify-center rounded-sm',
                archiveConfirming
                  ? 'text-white bg-[var(--status-error)] hover:bg-[var(--status-error)]/80'
                  : 'text-muted-foreground hover:text-[var(--status-error)]',
              )}
              aria-label={archiveConfirming
                ? (archivedBucket ? t('sessions.sidebar.bulkActions.deleteConfirm') : t('sessions.sidebar.bulkActions.archiveConfirm'))
                : (archivedBucket ? t('sessions.sidebar.bulkActions.delete') : t('sessions.sidebar.bulkActions.archive'))}
              onClick={(e) => {
                e.stopPropagation();
                if (archiveConfirming) {
                  handleDeleteSession(session, { archivedBucket });
                  setArchiveConfirming(false);
                } else {
                  setArchiveConfirming(true);
                }
              }}
            >
              {archivedBucket ? (
                <Icon name="delete-bin" className="h-3.5 w-3.5"  />
              ) : (
                <Icon name="archive" className="h-3.5 w-3.5"  />
              )}
            </button>
          </div>

          <DropdownMenu open={isMenuOpen} onOpenChange={handleMenuOpenChange}>
            <DropdownMenuTrigger asChild>
              <div
                className="fixed w-0 h-0 overflow-hidden"
                style={menuPosition ? { left: menuPosition.x, top: menuPosition.y } : undefined}
                aria-hidden="true"
              />
            </DropdownMenuTrigger>
            {sessionMenuContent}
          </DropdownMenu>
        </div>
      </DraggableSessionRow>
      {hasChildren && isExpanded
        ? node.children.map((child) => renderSessionNode(child, depth + 1, sessionDirectory ?? groupDirectory, projectId, archivedBucket, undefined, renderContext))
        : null}
      <Dialog open={exportDialogOpen} onOpenChange={setExportDialogOpen}>
        <DialogContent showCloseButton={false} className="max-w-sm gap-5">
          <DialogHeader>
            <DialogTitle>{t('sessions.sidebar.session.export.dialog.title')}</DialogTitle>
            <DialogDescription>
              {descendantCount === 1
                ? t('sessions.sidebar.session.export.dialog.descriptionSingle', { count: descendantCount })
                : t('sessions.sidebar.session.export.dialog.descriptionMany', { count: descendantCount })}
            </DialogDescription>
          </DialogHeader>
          <label className="flex items-center gap-2 typography-ui-label cursor-pointer">
            <input
              type="checkbox"
              checked={exportIncludeSubtasks}
              onChange={(e) => setExportIncludeSubtasks(e.target.checked)}
              className="h-4 w-4 rounded border-border accent-primary"
            />
            {t('sessions.sidebar.session.export.dialog.includeSubtasks')}
          </label>
          <DialogFooter>
            <Button
              type="button"
              onClick={() => setExportDialogOpen(false)}
              variant="outline"
              size="sm"
            >
              {t('sessions.sidebar.dialogs.cancel')}
            </Button>
            <Button
              type="button"
              onClick={() => {
                setExportDialogOpen(false);
                void doExportSession(exportIncludeSubtasks);
              }}
              size="sm"
            >
              {t('sessions.sidebar.session.export.dialog.confirm')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </React.Fragment>
  );
}

export const SessionNodeItem = React.memo(SessionNodeItemComponent, areEqual);
