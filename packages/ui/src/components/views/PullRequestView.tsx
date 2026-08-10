import React from 'react';
import { useShallow } from 'zustand/react/shallow';

import { Icon } from '@/components/icon/Icon';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { ScrollShadow } from '@/components/ui/ScrollShadow';
import { useDetectedWorktreeMetadata } from '@/hooks/useDetectedWorktreeRoot';
import { useEffectiveDirectory } from '@/hooks/useEffectiveDirectory';
import { useRuntimeAPIs } from '@/hooks/useRuntimeAPIs';
import type { GitRemote } from '@/lib/api/types';
import { useI18n } from '@/lib/i18n';
import { getRuntimeKey } from '@/lib/runtime-switch';
import { getRootBranch } from '@/lib/worktrees/worktreeStatus';
import { useGitBranches, useGitStatus, useGitStore } from '@/stores/useGitStore';
import { useSessionUIStore } from '@/sync/session-ui-store';
import { useSessionWorktreeStore } from '@/sync/session-worktree-store';
import { deriveBaseBranch } from './git/baseBranch';
import { PullRequestSection } from './git/PullRequestSection';

const normalizePath = (value?: string | null): string =>
  (value ?? '').replace(/\\/g, '/').replace(/\/+$/, '');

const remotesCacheByDirectory = new Map<string, GitRemote[]>();
const remoteUrlCacheByDirectory = new Map<string, string | null>();
const remoteCacheKey = (directory: string): string => `${getRuntimeKey()}::${directory}`;

export const PullRequestView: React.FC = () => {
  const { t } = useI18n();
  const { git } = useRuntimeAPIs();
  const currentDirectory = useEffectiveDirectory();
  const status = useGitStatus(currentDirectory ?? null);
  const branches = useGitBranches(currentDirectory ?? null);
  const ensureAll = useGitStore((state) => state.ensureAll);
  const currentSessionId = useSessionUIStore((state) => state.currentSessionId);
  const newSessionDraftOpen = useSessionUIStore((state) => state.newSessionDraft?.open ?? false);
  const { worktreeMetadataBySession, availableWorktrees } = useSessionUIStore(useShallow((state) => ({
    worktreeMetadataBySession: state.worktreeMetadata,
    availableWorktrees: state.availableWorktrees,
  })));

  const normalizedCurrentDirectory = normalizePath(currentDirectory);
  const inferredWorktreeMetadata = React.useMemo(() => {
    if (!normalizedCurrentDirectory) return undefined;

    const available = availableWorktrees.find(
      (metadata) => normalizePath(metadata.path) === normalizedCurrentDirectory,
    );
    if (available) return available;

    for (const metadata of worktreeMetadataBySession.values()) {
      if (normalizePath(metadata.path) === normalizedCurrentDirectory) return metadata;
    }
    return undefined;
  }, [availableWorktrees, normalizedCurrentDirectory, worktreeMetadataBySession]);

  const storeWorktreeMetadata = React.useMemo(() => {
    if (currentSessionId) {
      return worktreeMetadataBySession.get(currentSessionId) ?? inferredWorktreeMetadata;
    }
    return newSessionDraftOpen ? inferredWorktreeMetadata : undefined;
  }, [currentSessionId, inferredWorktreeMetadata, newSessionDraftOpen, worktreeMetadataBySession]);

  const worktreeAttachment = useSessionWorktreeStore((state) =>
    currentSessionId ? state.getAttachment(currentSessionId) : undefined,
  );
  const authoritativeProjectRoot = worktreeAttachment
    && !worktreeAttachment.degraded
    && !worktreeAttachment.legacy
    ? worktreeAttachment.worktreeRoot ?? undefined
    : undefined;
  const worktreeMetadata = useDetectedWorktreeMetadata(
    currentDirectory,
    storeWorktreeMetadata,
    status?.current ?? undefined,
  );

  React.useEffect(() => {
    if (!currentDirectory || !git) return;
    void ensureAll(currentDirectory, git);
  }, [currentDirectory, ensureAll, git]);

  const [rootBranchHint, setRootBranchHint] = React.useState<string | null>(null);
  React.useEffect(() => {
    const projectRoot = authoritativeProjectRoot || worktreeMetadata?.projectDirectory;
    if (!projectRoot) {
      setRootBranchHint(null);
      return;
    }

    let cancelled = false;
    void getRootBranch(projectRoot).then(
      (branch) => {
        if (cancelled) return;
        const normalized = branch.trim();
        setRootBranchHint(normalized && normalized !== 'HEAD' ? normalized : null);
      },
      () => {
        if (!cancelled) setRootBranchHint(null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [authoritativeProjectRoot, worktreeMetadata?.projectDirectory]);

  const [remotes, setRemotes] = React.useState<GitRemote[]>(() =>
    currentDirectory ? remotesCacheByDirectory.get(remoteCacheKey(currentDirectory)) ?? [] : [],
  );
  const [remoteUrl, setRemoteUrl] = React.useState<string | null>(() =>
    currentDirectory ? remoteUrlCacheByDirectory.get(remoteCacheKey(currentDirectory)) ?? null : null,
  );

  React.useEffect(() => {
    if (!currentDirectory || !git?.getRemotes) {
      setRemotes([]);
      return;
    }

    const cacheKey = remoteCacheKey(currentDirectory);
    setRemotes(remotesCacheByDirectory.get(cacheKey) ?? []);
    let cancelled = false;
    void git.getRemotes(currentDirectory).then(
      (remoteList) => {
        if (cancelled) return;
        const nextRemotes = remoteList ?? [];
        remotesCacheByDirectory.set(cacheKey, nextRemotes);
        setRemotes(nextRemotes);
      },
      () => {
        if (!cancelled) setRemotes(remotesCacheByDirectory.get(cacheKey) ?? []);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [currentDirectory, git]);

  React.useEffect(() => {
    if (!currentDirectory || !git?.getRemoteUrl) {
      setRemoteUrl(null);
      return;
    }

    const cacheKey = remoteCacheKey(currentDirectory);
    setRemoteUrl(remoteUrlCacheByDirectory.get(cacheKey) ?? null);
    let cancelled = false;
    void git.getRemoteUrl(currentDirectory).then(
      (url) => {
        if (cancelled) return;
        remoteUrlCacheByDirectory.set(cacheKey, url);
        setRemoteUrl(url);
      },
      () => {
        if (!cancelled) setRemoteUrl(remoteUrlCacheByDirectory.get(cacheKey) ?? null);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [currentDirectory, git]);

  const localBranches = React.useMemo(
    () => (branches?.all ?? []).filter((branch) => !branch.startsWith('remotes/')).sort(),
    [branches?.all],
  );
  const remoteBranches = React.useMemo(
    () => (branches?.all ?? [])
      .filter((branch) => branch.startsWith('remotes/'))
      .map((branch) => branch.replace(/^remotes\//, ''))
      .sort(),
    [branches?.all],
  );
  const effectiveRemotes = React.useMemo<GitRemote[]>(() => {
    if (remotes.length > 0) return remotes;

    const inferredNames = new Set<string>();
    const tracking = status?.tracking?.trim();
    if (tracking?.includes('/')) inferredNames.add(tracking.split('/')[0]);
    for (const branchName of remoteBranches) {
      const slashIndex = branchName.indexOf('/');
      if (slashIndex > 0) inferredNames.add(branchName.slice(0, slashIndex));
    }
    if (inferredNames.size === 0 && remoteUrl) inferredNames.add('origin');

    return Array.from(inferredNames).map((name) => ({
      name,
      fetchUrl: remoteUrl ?? '',
      pushUrl: remoteUrl ?? '',
    }));
  }, [remoteBranches, remoteUrl, remotes, status?.tracking]);
  const currentBranch = status?.current ?? null;
  const defaultBranch = React.useMemo(() => {
    const trackingRemote = status?.tracking?.trim().split('/')[0];
    return (trackingRemote && branches?.defaultBranches?.[trackingRemote])
      ?? branches?.defaultBranches?.origin;
  }, [branches, status?.tracking]);

  const baseBranch = React.useMemo(() => deriveBaseBranch({
    remoteNames: new Set(effectiveRemotes.map((remote) => remote.name)),
    localBranches,
    worktreeCreatedFromBranch: worktreeMetadata?.createdFromBranch,
    rootBranchHint,
    defaultBranch,
    headBranch: currentBranch,
  }), [currentBranch, defaultBranch, effectiveRemotes, localBranches, rootBranchHint, worktreeMetadata?.createdFromBranch]);

  if (!currentDirectory || !currentBranch) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
        <Icon name="git-pull-request" className="h-12 w-12 text-muted-foreground/50" />
        <div className="typography-ui-header text-foreground">{t('gitView.pullRequest.title')}</div>
        <div className="max-w-sm typography-micro text-muted-foreground">
          {t('gitView.pullRequest.createHint')}
        </div>
      </div>
    );
  }

  return (
    <ScrollableOverlay
      as={ScrollShadow}
      outerClassName="h-full min-h-0"
      className="px-4 py-3"
      disableHorizontal
      preventOverscroll
    >
      <PullRequestSection
        directory={currentDirectory}
        branch={currentBranch}
        baseBranch={baseBranch}
        trackingBranch={status?.tracking ?? undefined}
        remotes={remotes}
        remoteBranches={remoteBranches}
      />
    </ScrollableOverlay>
  );
};
