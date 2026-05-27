import React from 'react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
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
import { Icon } from "@/components/icon/Icon";
import { cn } from '@/lib/utils';
import type { GitLogEntry, CommitFileEntry } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { getCommitFileDiff, type CommitFileDiffResponse } from '@/lib/gitApi';
import { PierreDiffViewer } from '@/components/views/PierreDiffViewer';
import { getLanguageFromExtension } from '@/lib/toolHelpers';
import { GitGraphSegment } from './GitGraphSegment';
import type { LanedCommit } from './gitGraph';
import * as gitApi from '@/lib/gitApi';

const HISTORY_DIFF_REQUEST_TIMEOUT_MS = 15000;
const HISTORY_DIFF_LARGE_CHANGED_LINES = 500;
const HISTORY_DIFF_CACHE_MAX_ENTRIES = 12;
const HISTORY_DIFF_CACHE_MAX_TOTAL_SIZE_BYTES = 8 * 1024 * 1024;

type HistoryDiffCacheValue = CommitFileDiffResponse | 'loading' | 'error';

const getHistoryDiffCacheSize = (value: HistoryDiffCacheValue): number => {
  if (typeof value === 'string') {
    return 0;
  }
  return (value.original?.length ?? 0) + (value.modified?.length ?? 0);
};

const trimHistoryDiffCache = (cache: Map<string, HistoryDiffCacheValue>): Map<string, HistoryDiffCacheValue> => {
  if (cache.size <= HISTORY_DIFF_CACHE_MAX_ENTRIES) {
    let totalSize = 0;
    for (const value of cache.values()) {
      totalSize += getHistoryDiffCacheSize(value);
    }
    if (totalSize <= HISTORY_DIFF_CACHE_MAX_TOTAL_SIZE_BYTES) {
      return cache;
    }
  }

  const entries = Array.from(cache.entries()).reverse();
  const next = new Map<string, HistoryDiffCacheValue>();
  let totalSize = 0;
  for (const [key, value] of entries) {
    if (next.size >= HISTORY_DIFF_CACHE_MAX_ENTRIES) {
      continue;
    }
    const entrySize = getHistoryDiffCacheSize(value);
    if (totalSize + entrySize > HISTORY_DIFF_CACHE_MAX_TOTAL_SIZE_BYTES && next.size > 0) {
      continue;
    }
    next.set(key, value);
    totalSize += entrySize;
  }

  return new Map(Array.from(next.entries()).reverse());
};

/** Parse refs string into typed badges */
function parseRefBadges(refs: string): Array<{ type: 'head' | 'tag' | 'remote'; label: string }> {
  if (!refs || refs.trim() === '') return [];
  const tokens = refs.split(',').map((t) => t.trim()).filter(Boolean);
  return tokens.map((token) => {
    if (token.endsWith('/HEAD') || token === 'HEAD') {
      return { type: 'head' as const, label: token };
    }
    if (token.startsWith('tag: ')) {
      return { type: 'tag' as const, label: token.slice(5) };
    }
    if (token.includes('/')) {
      return { type: 'remote' as const, label: token };
    }
    return { type: 'head' as const, label: token };
  });
}

interface HistoryCommitRowProps {
  entry: GitLogEntry;
  isExpanded: boolean;
  onToggle: () => void;
  files: CommitFileEntry[];
  isLoadingFiles: boolean;
  onCopyHash: (hash: string) => void;
  directory: string | undefined;
  /** 'graph' enables lane visualization + action menu */
  mode?: 'history' | 'graph';
  /** Lane data for graph mode */
  lanedCommit?: LanedCommit;
  /** Total lane count for graph segment width */
  totalLanes?: number;
  /** Callback when cherry-pick/revert conflict detected */
  onConflict?: (files: string[]) => void;
  /** Callback after a successful action (checkout, cherry-pick, etc.) */
  onActionSuccess?: () => void;
}

type PendingAction =
  | { type: 'checkout'; hash: string }
  | { type: 'cherryPick'; hash: string }
  | { type: 'revert'; hash: string }
  | { type: 'reset'; hash: string; mode: 'soft' | 'mixed' | 'hard' }
  | { type: 'merge'; hash: string }
  | { type: 'rebase'; hash: string }
  | { type: 'createBranch'; hash: string; name: string }
  | null;

function formatCommitDate(date: string) {
  const value = new Date(date);
  if (Number.isNaN(value.getTime())) {
    return date;
  }

  return value.toLocaleString(undefined, {
    hour12: false,
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function getChangeTypeColor(changeType: string) {
  switch (changeType) {
    case 'A':
      return 'text-[var(--status-success)]';
    case 'D':
      return 'text-[var(--status-error)]';
    case 'M':
      return 'text-[var(--status-warning)]';
    case 'R':
      return 'text-[var(--status-info)]';
    default:
      return 'text-muted-foreground';
  }
}

export const HistoryCommitRow = React.memo(({
  entry,
  isExpanded,
  onToggle,
  files,
  isLoadingFiles,
  onCopyHash,
  directory,
  mode = 'history',
  lanedCommit,
  totalLanes = 0,
  onConflict,
  onActionSuccess,
}: HistoryCommitRowProps) => {
  const { t } = useI18n();
  const [openDiffPaths, setOpenDiffPaths] = React.useState<Set<string>>(new Set());
  const [diffCache, setDiffCache] = React.useState<Map<string, HistoryDiffCacheValue>>(new Map());
  const [forceRenderLargePaths, setForceRenderLargePaths] = React.useState<Set<string>>(new Set());
  const [pendingAction, setPendingAction] = React.useState<PendingAction>(null);
  const [isExecuting, setIsExecuting] = React.useState(false);

  const loadFileDiff = React.useCallback(async (file: CommitFileEntry) => {
    const key = file.path;
    if (!directory) {
      setDiffCache(prev => new Map(prev).set(key, 'error'));
      return;
    }

    setDiffCache(prev => trimHistoryDiffCache(new Map(prev).set(key, 'loading')));
    try {
      const fetchPromise = getCommitFileDiff(directory, entry.hash, file.path, false);
      const timeoutPromise = new Promise<never>((_, reject) => {
        setTimeout(() => reject(new Error(`Timed out after ${HISTORY_DIFF_REQUEST_TIMEOUT_MS}ms`)), HISTORY_DIFF_REQUEST_TIMEOUT_MS);
      });
      const result = await Promise.race([fetchPromise, timeoutPromise]);
      setDiffCache(prev => trimHistoryDiffCache(new Map(prev).set(key, result)));
    } catch {
      setDiffCache(prev => new Map(prev).set(key, 'error'));
    }
  }, [directory, entry.hash]);

  const toggleFileDiff = React.useCallback(async (file: CommitFileEntry) => {
    const key = file.path;

    if (file.changeType === 'R' || file.isBinary) {
      setOpenDiffPaths(prev => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
        } else {
          next.add(key);
        }
        return next;
      });
      return;
    }

    const cached = diffCache.get(key);
    const isOpen = openDiffPaths.has(key);

    if (isOpen && cached && cached !== 'error') {
      setOpenDiffPaths(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      return;
    }

    setOpenDiffPaths(prev => {
      const next = new Set(prev);
      next.add(key);
      return next;
    });

    if (cached && cached !== 'error') return;

    const changedLines = file.insertions + file.deletions;
    if (changedLines > HISTORY_DIFF_LARGE_CHANGED_LINES && !forceRenderLargePaths.has(key)) {
      return;
    }

    await loadFileDiff(file);
  }, [diffCache, forceRenderLargePaths, loadFileDiff, openDiffPaths]);

  const executeAction = React.useCallback(async (action: PendingAction) => {
    if (!action || !directory) return;
    setIsExecuting(true);
    try {
      switch (action.type) {
        case 'checkout': {
          const result = await gitApi.checkoutCommit(directory, action.hash);
          if (result.detached) {
            // Show detached HEAD toast
          }
          break;
        }
        case 'cherryPick': {
          const result = await gitApi.cherryPick(directory, action.hash);
          if (result.conflict && result.conflictFiles) {
            onConflict?.(result.conflictFiles);
          }
          break;
        }
        case 'revert': {
          const result = await gitApi.revertCommit(directory, action.hash);
          if (result.conflict && result.conflictFiles) {
            onConflict?.(result.conflictFiles);
          }
          break;
        }
        case 'reset': {
          await gitApi.resetToCommit(directory, action.hash, action.mode);
          break;
        }
        case 'merge': {
          await gitApi.merge(directory, { branch: action.hash });
          break;
        }
        case 'rebase': {
          await gitApi.rebase(directory, { onto: action.hash });
          break;
        }
        case 'createBranch': {
          await gitApi.createBranch(directory, action.name, action.hash);
          break;
        }
      }
      onActionSuccess?.();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Action failed';
      import('@/components/ui').then(({ toast }) => toast.error(message));
    } finally {
      setIsExecuting(false);
      setPendingAction(null);
    }
  }, [directory, onActionSuccess, onConflict]);

  const refBadges = React.useMemo(() => parseRefBadges(entry.refs), [entry.refs]);

  const isGraphMode = mode === 'graph';

  return (
    <li>
      <button
        type="button"
        onClick={onToggle}
        className={cn(
          'w-full flex items-start gap-3 px-3 py-2 text-left transition-colors',
          isExpanded ? 'bg-sidebar/90' : 'hover:bg-sidebar/40',
          isGraphMode && 'gap-1'
        )}
      >
        {isGraphMode && lanedCommit && totalLanes > 0 ? (
          <GitGraphSegment
            laned={lanedCommit}
            totalLanes={totalLanes}
            isExpanded={isExpanded}
          />
        ) : (
          <div
            className="h-2 w-2 translate-y-2 rounded-full shrink-0"
            style={{ backgroundColor: 'var(--status-success)' }}
            aria-hidden
          />
        )}
        <div className="min-w-0 flex-1">
          <p className="typography-ui-label font-medium text-foreground line-clamp-1">
            {entry.message}
          </p>
          <div className="flex items-center gap-1 typography-meta text-muted-foreground">
            <div className="flex items-center gap-1 min-w-0 truncate">
              <span className="truncate min-w-[3ch]" title={entry.author_name}>
                {entry.author_name}
              </span>
              <span className="shrink-0">·</span>
              <span className="truncate min-w-0" title={formatCommitDate(entry.date)}>
                {formatCommitDate(entry.date)}
              </span>
            </div>
            <span className="shrink-0">·</span>
            <code className="shrink-0 font-mono">
              {entry.hash.slice(0, 8)}
            </code>
            {refBadges.length > 0 && (
              <>
                <span className="shrink-0">·</span>
                <span className="flex items-center gap-1 shrink-0 overflow-hidden">
                  {refBadges.slice(0, 3).map((badge, i) => (
                    <span
                      key={i}
                      className={cn(
                        'inline-flex items-center rounded px-1 typography-micro',
                        badge.type === 'head' && 'bg-[var(--status-success)]/15 text-[var(--status-success)]',
                        badge.type === 'tag' && 'bg-[var(--status-info)]/15 text-[var(--status-info)]',
                        badge.type === 'remote' && 'bg-[var(--status-warning)]/15 text-[var(--status-warning)]',
                      )}
                    >
                      {badge.label}
                    </span>
                  ))}
                </span>
              </>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-5 px-1 shrink-0"
                  onClick={(e) => {
                    e.stopPropagation();
                    onCopyHash(entry.hash);
                  }}
                >
                  <Icon name="file-copy" className="size-3" />
                </Button>
              </TooltipTrigger>
              <TooltipContent sideOffset={8}>{t('gitView.history.copySha')}</TooltipContent>
            </Tooltip>
            {isGraphMode && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-5 px-1 shrink-0"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <Icon name="more-2-fill" className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => setPendingAction({ type: 'checkout', hash: entry.hash })}>
                    <Icon name="git-commit" className="size-4 mr-2" />
                    {t('gitView.history.actions.checkout')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setPendingAction({ type: 'cherryPick', hash: entry.hash })}>
                    <Icon name="git-merge" className="size-4 mr-2" />
                    {t('gitView.history.actions.cherryPick')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPendingAction({ type: 'revert', hash: entry.hash })}>
                    <Icon name="arrow-go-back" className="size-4 mr-2" />
                    {t('gitView.history.actions.revert')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Icon name="git-branch" className="size-4 mr-2" />
                      {t('gitView.history.actions.createBranch')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <CreateBranchInline
                        onSubmit={(name) => setPendingAction({ type: 'createBranch', hash: entry.hash, name })}
                      />
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                  <DropdownMenuSeparator />
                  <DropdownMenuItem onSelect={() => setPendingAction({ type: 'merge', hash: entry.hash })}>
                    <Icon name="git-merge" className="size-4 mr-2" />
                    {t('gitView.history.actions.merge')}
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => setPendingAction({ type: 'rebase', hash: entry.hash })}>
                    <Icon name="git-commit" className="size-4 mr-2" />
                    {t('gitView.history.actions.rebase')}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  <DropdownMenuSub>
                    <DropdownMenuSubTrigger>
                      <Icon name="arrow-go-back" className="size-4 mr-2" />
                      {t('gitView.history.actions.reset')}
                    </DropdownMenuSubTrigger>
                    <DropdownMenuSubContent>
                      <DropdownMenuItem onSelect={() => setPendingAction({ type: 'reset', hash: entry.hash, mode: 'soft' })}>
                        {t('gitView.history.actions.resetSoft')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setPendingAction({ type: 'reset', hash: entry.hash, mode: 'mixed' })}>
                        {t('gitView.history.actions.resetMixed')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onSelect={() => setPendingAction({ type: 'reset', hash: entry.hash, mode: 'hard' })}>
                        {t('gitView.history.actions.resetHard')}
                      </DropdownMenuItem>
                    </DropdownMenuSubContent>
                  </DropdownMenuSub>
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        </div>
      </button>

      {/* Confirmation banner for pending actions */}
      {pendingAction && (
        <div className="px-3 py-2 border-t border-border/40 bg-[var(--status-warning)]/10 flex items-center gap-2">
          <Icon name="error-warning" className="size-4 text-[var(--status-warning)] shrink-0" />
          <span className="typography-micro text-foreground flex-1">
            {pendingAction.type === 'checkout' && t('gitView.history.actions.checkoutConfirm')}
            {pendingAction.type === 'cherryPick' && t('gitView.history.actions.cherryPickConfirm')}
            {pendingAction.type === 'revert' && t('gitView.history.actions.revertConfirm')}
            {pendingAction.type === 'merge' && t('gitView.history.actions.mergeConfirm')}
            {pendingAction.type === 'rebase' && t('gitView.history.actions.rebaseConfirm')}
            {pendingAction.type === 'reset' && pendingAction.mode === 'soft' && t('gitView.history.actions.resetSoftConfirm')}
            {pendingAction.type === 'reset' && pendingAction.mode === 'mixed' && t('gitView.history.actions.resetMixedConfirm')}
            {pendingAction.type === 'reset' && pendingAction.mode === 'hard' && t('gitView.history.actions.resetHardConfirm')}
            {pendingAction.type === 'createBranch' && t('gitView.history.actions.createBranch')}
          </span>
          <Button
            variant="ghost"
            size="xs"
            className="h-6 px-2 text-[var(--status-error)]"
            onClick={() => setPendingAction(null)}
          >
            {t('gitView.history.actions.cancelButton')}
          </Button>
          <Button
            variant="ghost"
            size="xs"
            className="h-6 px-2 text-[var(--status-success)]"
            onClick={() => executeAction(pendingAction)}
            disabled={isExecuting}
          >
            {isExecuting ? '...' : pendingAction.type === 'reset' && pendingAction.mode === 'hard'
              ? t('gitView.history.actions.resetHardConfirmButton')
              : t('gitView.history.actions.confirmButton')}
          </Button>
        </div>
      )}

      {isExpanded && (
        <div className="px-3 pb-2 pl-8 border-t border-border/40">
          {isLoadingFiles ? (
            <div className="flex items-center gap-2 py-2">
              <Icon name="loader-4" className="size-4 animate-spin text-muted-foreground" />
              <span className="typography-micro text-muted-foreground">{t('gitView.history.loadingFiles')}</span>
            </div>
          ) : files.length === 0 ? (
            <p className="typography-micro text-muted-foreground py-2">{t('gitView.history.noFiles')}</p>
          ) : (
            <ul className="space-y-0.5 py-2">
              {files.map((file) => (
                <li key={file.path}>
                  <button
                    type="button"
                    onClick={() => toggleFileDiff(file)}
                    className={cn(
                      'w-full flex items-center gap-2 typography-micro text-left cursor-pointer transition-colors rounded px-1',
                      openDiffPaths.has(file.path) ? 'bg-sidebar/90' : 'hover:bg-sidebar/40'
                    )}
                  >
                    <span
                      className={cn(
                        'font-semibold w-3 text-center shrink-0',
                        getChangeTypeColor(file.changeType)
                      )}
                    >
                      {file.changeType}
                    </span>
                    <span className="truncate text-foreground min-w-0" title={file.path}>
                      {file.path}
                    </span>
                    {!file.isBinary && (
                      <span className="shrink-0">
                        <span style={{ color: 'var(--status-success)' }}>
                          +{file.insertions}
                        </span>
                        <span className="text-muted-foreground mx-0.5">/</span>
                        <span style={{ color: 'var(--status-error)' }}>
                          -{file.deletions}
                        </span>
                      </span>
                    )}
                    {file.isBinary && (
                      <span className="typography-micro text-muted-foreground shrink-0">
                        {t('gitView.history.binary')}
                      </span>
                    )}
                    <Icon
                      name={openDiffPaths.has(file.path) ? 'arrow-down-s' : 'arrow-right-s'}
                      className="size-3 shrink-0 text-muted-foreground"
                    />
                  </button>

                  {openDiffPaths.has(file.path) && (
                    <div className="max-h-[400px] overflow-y-auto rounded border border-border/40 mx-2 mb-1" data-diff-virtual-root data-diff-virtual-content>
                      {file.changeType === 'R' ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">{t('gitView.history.renamedNoDiff')}</div>
                      ) : file.isBinary ? (
                        <div className="px-3 py-2 text-sm text-muted-foreground">{t('gitView.history.binaryNoDiff')}</div>
                      ) : (() => {
                        const changedLines = file.insertions + file.deletions;
                        if (!forceRenderLargePaths.has(file.path) && changedLines > HISTORY_DIFF_LARGE_CHANGED_LINES) {
                          return (
                            <div className="flex flex-col items-start gap-1 px-3 py-2 text-sm text-muted-foreground">
                              <div className="typography-ui-label font-semibold text-foreground">
                                {t('gitView.history.largeDiffTitle', { count: changedLines })}
                              </div>
                              <div className="typography-meta text-muted-foreground">
                                {t('gitView.history.largeDiffDescription')}
                              </div>
                              <Button
                                type="button"
                                variant="ghost"
                                size="xs"
                                className="h-6 px-0 text-primary hover:bg-transparent hover:underline"
                                onClick={() => {
                                  setForceRenderLargePaths(prev => new Set(prev).add(file.path));
                                  void loadFileDiff(file);
                                }}
                              >
                                {t('gitView.history.renderDiffAnyway')}
                              </Button>
                            </div>
                          );
                        }

                        const cached = diffCache.get(file.path);
                        if (cached === 'loading' || cached === undefined) {
                          return <div className="px-3 py-2 text-sm text-muted-foreground">{t('gitView.history.loadingDiff')}</div>;
                        }
                        if (cached === 'error') {
                          return (
                            <button
                              type="button"
                              onClick={() => toggleFileDiff(file)}
                              className="w-full text-left px-3 py-2 text-sm text-muted-foreground hover:bg-[var(--interactive-hover)] transition-colors"
                            >
                              {t('gitView.history.diffError')}
                            </button>
                          );
                        }
                        return (
                          <PierreDiffViewer
                            original={cached.original}
                            modified={cached.modified}
                            language={getLanguageFromExtension(file.path) || ''}
                            fileName={file.path}
                            renderSideBySide={false}
                            layout="inline"
                          />
                        );
                      })()}
                    </div>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </li>
  );
});

/** Inline branch creation form for the dropdown submenu */
const CreateBranchInline: React.FC<{ onSubmit: (name: string) => void }> = ({ onSubmit }) => {
  const { t } = useI18n();
  const [name, setName] = React.useState('');
  return (
    <div className="flex items-center gap-1 p-1">
      <input
        type="text"
        className="h-6 w-full rounded border border-border bg-background px-2 typography-micro text-foreground outline-none focus:border-primary"
        placeholder={t('gitView.history.actions.createBranchPlaceholder')}
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && name.trim()) {
            e.preventDefault();
            onSubmit(name.trim());
          }
        }}
        autoFocus
      />
      <Button
        variant="ghost"
        size="xs"
        className="h-6 px-2 shrink-0"
        disabled={!name.trim()}
        onClick={() => onSubmit(name.trim())}
      >
        {t('gitView.history.actions.createBranchConfirm')}
      </Button>
    </div>
  );
};
