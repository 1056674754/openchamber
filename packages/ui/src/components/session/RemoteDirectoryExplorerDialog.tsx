import React from 'react';
import { serverRegistry } from '@/lib/opencode/server-registry';
import { useProjectsStore } from '@/stores/useProjectsStore';
import { useDesktopSshStore } from '@/stores/useDesktopSshStore';
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { toast } from '@/components/ui';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/utils';
import { RiFolderLine, RiArrowUpSLine, RiServerLine, RiWifiLine, RiWifiOffLine, RiLoader4Line } from '@remixicon/react';

interface RemoteDirectoryExplorerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type BrowseEntry = {
  name: string;
  path: string;
};

type BrowseRow =
  | { type: 'up'; value: 'browse:up'; name: string; path: string | null; disabled?: false }
  | { type: 'directory'; value: string; name: string; path: string; disabled: boolean };

const isRootPath = (value: string): boolean => value === '/';

const normalizeSeparators = (value: string): string => value.replace(/\\/g, '/');

const trimTrailingSeparators = (value: string): string => {
  if (!value || isRootPath(value)) return value;
  let result = value;
  while (result.length > 1 && result.endsWith('/')) {
    result = result.slice(0, -1);
  }
  return result;
};

const hasTrailingPathSeparator = (value: string): boolean => value.endsWith('/');

const ensureBrowseDirectoryPath = (value: string): string => {
  const trimmed = value.trim();
  if (!trimmed || hasTrailingPathSeparator(trimmed)) return trimmed;
  return `${trimmed}/`;
};

const getLastPathSeparatorIndex = (value: string): number => value.lastIndexOf('/');

const getBrowseDirectoryPath = (value: string): string => {
  if (hasTrailingPathSeparator(value)) return value;
  const lastSeparator = getLastPathSeparatorIndex(value);
  if (lastSeparator < 0) return value;
  return value.slice(0, lastSeparator + 1);
};

const getBrowseLeafPathSegment = (value: string): string => {
  const lastSeparator = getLastPathSeparatorIndex(value);
  return value.slice(lastSeparator + 1);
};

const getBrowseParentPath = (value: string): string | null => {
  const trimmed = trimTrailingSeparators(value.trim());
  if (!trimmed || trimmed === '~' || trimmed === '~/' || trimmed === '/') return null;
  const lastSeparator = getLastPathSeparatorIndex(trimmed);
  if (lastSeparator < 0) return null;
  if (trimmed.startsWith('~/') && lastSeparator <= 1) return '~/';
  if (lastSeparator === 0) return '/';
  return `${trimmed.slice(0, lastSeparator)}/`;
};

const canNavigateUp = (value: string): boolean => hasTrailingPathSeparator(value) && getBrowseParentPath(value) !== null;

const appendBrowsePathSegment = (currentPath: string, segment: string): string => (
  `${getBrowseDirectoryPath(currentPath)}${segment}/`
);

const normalizeDirectoryPath = (path: string | null | undefined): string | null => {
  if (!path) return null;
  const normalized = trimTrailingSeparators(normalizeSeparators(path.trim()));
  if (!normalized) return null;
  return normalized.toLowerCase();
};

const focusPathInput = (input: HTMLInputElement | null): void => {
  if (!input) return;
  input.focus({ preventScroll: true });
  const valueLength = input.value.length;
  input.setSelectionRange(valueLength, valueLength);
  input.scrollLeft = input.scrollWidth;
};

const isPrimaryModifierPressed = (event: React.KeyboardEvent<HTMLInputElement>): boolean => {
  const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
  return isMac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
};

export const RemoteDirectoryExplorerDialog: React.FC<RemoteDirectoryExplorerDialogProps> = ({
  open,
  onOpenChange,
}) => {
  const { t } = useI18n();
  const projects = useProjectsStore((s) => s.projects);
  const ensureRemoteProject = useProjectsStore((s) => s.ensureRemoteProject);
  const inputRef = React.useRef<HTMLInputElement>(null);

  const sshInstances = useDesktopSshStore((s) => s.instances);
  const sshStatuses = useDesktopSshStore((s) => s.statusesById);
  const sshConnect = useDesktopSshStore((s) => s.connect);
  const sshLoad = useDesktopSshStore((s) => s.load);
  const [selectedServerId, setSelectedServerId] = React.useState<string | null>(null);
  const [remoteHome, setRemoteHome] = React.useState('');
  const [query, setQuery] = React.useState('~/');
  const [entries, setEntries] = React.useState<BrowseEntry[]>([]);
  const [isLoading, setIsLoading] = React.useState(false);
  const [highlightedIndex, setHighlightedIndex] = React.useState(0);
  const [isConfirming, setIsConfirming] = React.useState(false);

  const addedProjectPaths = React.useMemo(() => {
    if (!selectedServerId) return new Set<string>();
    return new Set(
      projects
        .filter((p) => p.serverId === selectedServerId)
        .map((project) => normalizeDirectoryPath(project.path))
        .filter((path): path is string => Boolean(path))
    );
  }, [projects, selectedServerId]);

  React.useEffect(() => {
    if (!open) return;
    void sshLoad();
    setSelectedServerId(null);
    setRemoteHome('');
    setQuery('~/');
    setEntries([]);
    setHighlightedIndex(0);
    setIsConfirming(false);
    requestAnimationFrame(() => focusPathInput(inputRef.current));
  }, [open, sshLoad]);

  const selectedServer = React.useMemo(
    () => (selectedServerId ? serverRegistry.get(selectedServerId) ?? null : null),
    [selectedServerId]
  );

  const selectedStatus = selectedServerId ? sshStatuses[selectedServerId] : undefined;
  const selectedFetchBaseUrl = selectedStatus?.phase === 'ready' ? selectedStatus.localUrl || '' : '';

  const selectedInstanceReady = React.useMemo(() => {
    if (!selectedServerId) return false;
    return sshStatuses[selectedServerId]?.phase === 'ready';
  }, [selectedServerId, sshStatuses]);

  const browseDirectoryDisplayPath = React.useMemo(() => getBrowseDirectoryPath(query), [query]);
  const browseFilterQuery = React.useMemo(
    () => (hasTrailingPathSeparator(query) ? '' : getBrowseLeafPathSegment(query)),
    [query]
  );

  React.useEffect(() => {
    if (!open || !selectedServer || !selectedFetchBaseUrl || !browseDirectoryDisplayPath) {
      setEntries([]);
      return;
    }

    const absPath = browseDirectoryDisplayPath.startsWith('~/')
      ? `${remoteHome}${browseDirectoryDisplayPath.slice(1)}`
      : browseDirectoryDisplayPath;

    if (!absPath) return;

    let cancelled = false;
    setIsLoading(true);

    fetch(`${selectedFetchBaseUrl}/api/fs/list?path=${encodeURIComponent(absPath)}`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
        }
        return res.json() as Promise<{ entries: Array<{ name: string; path: string; isDirectory: boolean; isFile: boolean }> }>;
      })
      .then((data) => {
        if (cancelled) return;
        const nextEntries = data.entries
          .filter((entry) => entry.isDirectory)
          .map((entry) => ({
            name: entry.name,
            path: normalizeSeparators(entry.path),
          }))
          .sort((left, right) => left.name.localeCompare(right.name));
        setEntries(nextEntries);
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setEntries([]);
          const detail = err instanceof Error ? `${err.message} (${selectedFetchBaseUrl})` : `${String(err)} (${selectedFetchBaseUrl})`;
          toast.error(
            t('remoteDirectoryExplorer.errorFetchListDetail', {
              path: absPath,
              host: selectedServer.config.label,
              detail,
            }),
            { duration: 8000 },
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedServer, selectedFetchBaseUrl, browseDirectoryDisplayPath, remoteHome, t]);

  const filteredEntries = React.useMemo(() => {
    const lowerFilter = browseFilterQuery.toLowerCase();
    return entries.filter((entry) => entry.name.toLowerCase().startsWith(lowerFilter));
  }, [browseFilterQuery, entries]);

  const rows = React.useMemo<BrowseRow[]>(() => {
    const nextRows: BrowseRow[] = [];
    if (canNavigateUp(query)) {
      nextRows.push({ type: 'up', value: 'browse:up', name: '..', path: getBrowseParentPath(query) });
    }
    for (const entry of filteredEntries) {
      const normalized = normalizeDirectoryPath(entry.path);
      nextRows.push({
        type: 'directory',
        value: `browse:${entry.path}`,
        name: entry.name,
        path: entry.path,
        disabled: Boolean(normalized && addedProjectPaths.has(normalized)),
      });
    }
    return nextRows;
  }, [addedProjectPaths, filteredEntries, query]);

  React.useEffect(() => {
    setHighlightedIndex(0);
  }, [query, rows.length]);

  const targetPath = React.useMemo(() => {
    if (!remoteHome) return '';
    return trimTrailingSeparators(
      query.startsWith('~/') ? `${remoteHome}${query.slice(1)}` : query
    );
  }, [remoteHome, query]);

  const normalizedTargetPath = normalizeDirectoryPath(targetPath);
  const isAlreadyAdded = Boolean(normalizedTargetPath && addedProjectPaths.has(normalizedTargetPath));
  const canAddProject = !isConfirming && !isAlreadyAdded && Boolean(targetPath) && Boolean(selectedServerId);

  const handleClose = React.useCallback(() => {
    onOpenChange(false);
  }, [onOpenChange]);

  const handleAddProject = React.useCallback(async () => {
    if (!targetPath || !selectedServerId || isConfirming) return;
    const normalized = normalizeDirectoryPath(targetPath);
    if (normalized && addedProjectPaths.has(normalized)) return;

    setIsConfirming(true);
    try {
      const added = ensureRemoteProject(targetPath, selectedServerId);
      if (!added) {
        toast.error(t('remoteDirectoryExplorer.error'));
        return;
      }
      toast.success(t('remoteDirectoryExplorer.success'));
      handleClose();
    } catch {
      toast.error(t('remoteDirectoryExplorer.error'));
    } finally {
      setIsConfirming(false);
    }
  }, [targetPath, selectedServerId, isConfirming, addedProjectPaths, ensureRemoteProject, t, handleClose]);

  React.useEffect(() => {
    if (!open || !selectedServerId) return;
    const status = sshStatuses[selectedServerId];
    if (status?.phase !== 'ready' || !status.localUrl) return;

    const server = serverRegistry.get(selectedServerId);
    if (!server) return;

    setIsLoading(true);
    let cancelled = false;
    fetch(`${status.localUrl}/api/fs/home`)
      .then(async (res) => {
        if (!res.ok) {
          const body = await res.text().catch(() => '');
          throw new Error(`HTTP ${res.status}${body ? `: ${body.slice(0, 200)}` : ''}`);
        }
        return res.json();
      })
      .then((data) => {
        if (cancelled) return;
        const home = (data as { home?: string }).home || '';
        setRemoteHome(home);
        setQuery('~/');
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          const detail = err instanceof Error ? `${err.message} (${status.localUrl})` : `${String(err)} (${status.localUrl})`;
          toast.error(
            t('remoteDirectoryExplorer.errorFetchHomeDetail', {
              host: server.config.label,
              detail,
            }),
            { duration: 8000 },
          );
        }
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });

    return () => { cancelled = true; };
  }, [open, selectedServerId, sshStatuses, t]);

  const handleQueryChange = React.useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const value = normalizeSeparators(e.target.value);
    setQuery(value);
  }, []);

  const browseToDisplayPath = React.useCallback((displayPath: string) => {
    setQuery(ensureBrowseDirectoryPath(displayPath));
  }, []);

  const handleRowClick = React.useCallback((row: BrowseRow) => {
    if (row.type === 'directory' && row.disabled) return;
    if (row.type === 'up') {
      if (row.path) browseToDisplayPath(row.path);
      return;
    }
    setQuery(appendBrowsePathSegment(query, row.name));
  }, [query, browseToDisplayPath]);

  const handleKeyDown = React.useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.min(rows.length - 1, index + 1));
      return;
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlightedIndex((index) => Math.max(0, index - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (isPrimaryModifierPressed(event)) {
        void handleAddProject();
        return;
      }
      const highlightedRow = rows[highlightedIndex];
      if (highlightedRow && (highlightedRow.type === 'up' || (highlightedRow.type === 'directory' && !highlightedRow.disabled))) {
        handleRowClick(highlightedRow);
      }
      return;
    }
    if (event.key === 'Backspace' && query === '') {
      event.preventDefault();
      handleClose();
    }
  }, [rows, handleAddProject, highlightedIndex, handleRowClick, query, handleClose]);

  const submitActionLabel = isAlreadyAdded
    ? t('remoteDirectoryExplorer.alreadyAdded')
    : t('remoteDirectoryExplorer.addProject');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex w-full max-w-xl flex-col gap-0 overflow-hidden p-0 sm:max-h-[80vh]"
        onOpenAutoFocus={(event) => event.preventDefault()}
      >
        <DialogHeader className="px-5 pb-2 pt-5">
          <DialogTitle>{t('remoteDirectoryExplorer.title')}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 px-5 pb-0">
          <div className="flex min-h-0 flex-1 flex-col gap-3">
            <div className="flex flex-col gap-1.5">
              <label className="text-sm text-[var(--surface-foreground)]">
                {t('remoteDirectoryExplorer.selectHost')}
              </label>
              <div className="max-h-[12rem] overflow-y-auto rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)]">
                {sshInstances.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-[var(--surface-mutedForeground)]">
                    {t('remoteDirectoryExplorer.noHosts')}
                  </div>
                ) : (
                  <div className="p-1">
                    {sshInstances.map((instance) => {
                      const status = sshStatuses[instance.id];
                      const phase = status?.phase ?? 'idle';
                      const isReady = phase === 'ready';
                      const isConnecting = !['idle', 'ready', 'error'].includes(phase);
                      const isError = phase === 'error';
                      const isSelected = selectedServerId === instance.id;
                      const label = instance.nickname || instance.sshCommand || instance.id;

                      return (
                        <button
                          key={instance.id}
                          type="button"
                          onClick={() => {
                            setSelectedServerId(instance.id);
                            if (isReady && status?.localUrl) {
                              serverRegistry.register({ id: instance.id, label, baseUrl: status.localUrl });
                            }
                          }}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left transition-colors',
                            isSelected && 'bg-[var(--interactive-selection)] text-[var(--interactive-selection-foreground)]',
                            !isSelected && 'hover:bg-[var(--interactive-hover)]',
                          )}
                        >
                          {isReady ? (
                            <RiWifiLine className="h-4 w-4 flex-shrink-0 text-[var(--status-success)]" />
                          ) : isConnecting ? (
                            <RiLoader4Line className="h-4 w-4 flex-shrink-0 animate-spin text-[var(--status-warning)]" />
                          ) : isError ? (
                            <RiWifiOffLine className="h-4 w-4 flex-shrink-0 text-[var(--status-error)]" />
                          ) : (
                            <RiServerLine className="h-4 w-4 flex-shrink-0 text-[var(--surface-mutedForeground)]" />
                          )}
                          <span className="flex-1 truncate text-sm">{label}</span>
                          {(phase === 'idle' || phase === 'error') && (
                            <span
                              role="button"
                              tabIndex={0}
                              onClick={(e) => { e.stopPropagation(); void sshConnect(instance.id); }}
                              onKeyDown={(e) => { if (e.key === 'Enter') { e.stopPropagation(); void sshConnect(instance.id); } }}
                              className="flex-shrink-0 rounded px-1.5 py-0.5 text-xs text-[var(--primary-base)] hover:bg-[var(--interactive-hover)]"
                            >
                              {phase === 'error' ? t('remoteDirectoryExplorer.retry') : t('remoteDirectoryExplorer.connect')}
                            </span>
                          )}
                          {isConnecting && (
                            <span className="flex-shrink-0 text-xs text-[var(--surface-mutedForeground)]">
                              {t('remoteDirectoryExplorer.phaseConnecting')}
                            </span>
                          )}
                          {isReady && (
                            <span className="flex-shrink-0 text-xs text-[var(--status-success)]">
                              {t('remoteDirectoryExplorer.phaseConnected')}
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>

            <div className="relative flex min-h-0 flex-1 flex-col">
              <div className="relative px-2.5 py-1.5">
                <RiServerLine className="pointer-events-none absolute left-5 top-1/2 h-4 w-4 -translate-y-1/2 text-[var(--surface-mutedForeground)]" />
                <Input
                  ref={inputRef}
                  value={query}
                  onChange={handleQueryChange}
                  onKeyDown={handleKeyDown}
                  placeholder={t('remoteDirectoryExplorer.pathPlaceholder')}
                  className="border-transparent bg-transparent pl-9 font-mono text-[var(--surface-foreground)] shadow-none focus-visible:ring-0"
                  disabled={!selectedInstanceReady}
                  spellCheck={false}
                  autoComplete="off"
                  autoCorrect="off"
                  autoCapitalize="off"
                />
              </div>

              <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--interactive-border)] bg-[var(--surface-elevated)] shadow-sm">
                <div className="max-h-[min(28rem,58vh)] overflow-y-auto p-2">
                  <div className="px-2 pb-1 pt-0.5 text-xs font-medium uppercase tracking-wide text-[var(--surface-mutedForeground)]">
                    {t('remoteDirectoryExplorer.folders')}
                  </div>
                  {isLoading ? (
                    <div className="py-10 text-center text-[var(--surface-mutedForeground)]">
                      {t('remoteDirectoryExplorer.loading')}
                    </div>
                  ) : rows.length === 0 ? (
                    <div className="py-10 text-center text-[var(--surface-mutedForeground)]">
                      {t('remoteDirectoryExplorer.noFolders')}
                    </div>
                  ) : (
                    <div>
                      {rows.map((row, index) => {
                        const isActive = index === highlightedIndex;
                        return (
                          <button
                            key={row.value}
                            type="button"
                            disabled={row.type === 'directory' && row.disabled}
                            onMouseEnter={() => setHighlightedIndex(index)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handleRowClick(row)}
                            className={cn(
                              'flex w-full cursor-pointer items-center gap-1.5 rounded-md px-2 py-[1px] text-left text-[13px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50',
                              isActive && 'bg-[var(--interactive-selection)] text-[var(--interactive-selection-foreground)]',
                              !isActive && 'hover:bg-[var(--interactive-hover)]',
                              row.type === 'directory' && row.disabled && 'cursor-not-allowed opacity-45 hover:bg-transparent'
                            )}
                          >
                            {row.type === 'up' ? (
                              <RiArrowUpSLine className="h-3.5 w-3.5 flex-shrink-0 text-[var(--surface-mutedForeground)]" />
                            ) : (
                              <RiFolderLine className="h-3.5 w-3.5 flex-shrink-0 text-[var(--surface-mutedForeground)]" />
                            )}
                            <span className="flex min-w-0 flex-1 items-center gap-1.5">
                              <span className="truncate text-[var(--surface-foreground)]">{row.name}</span>
                            </span>
                            {row.type === 'directory' && row.disabled ? (
                              <span className="rounded-full border border-[var(--interactive-border)] px-1.5 py-px text-[11px] text-[var(--surface-mutedForeground)]">
                                {t('remoteDirectoryExplorer.alreadyAdded')}
                              </span>
                            ) : null}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter className="flex w-full flex-row justify-end gap-2 px-5 py-3">
          <Button variant="ghost" size="xs" onClick={handleClose} disabled={isConfirming}>
            {t('directoryExplorerDialog.actions.cancel')}
          </Button>
          <Button size="xs" onClick={() => void handleAddProject()} disabled={!canAddProject}>
            {isConfirming ? t('directoryExplorerDialog.actions.adding') : submitActionLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
