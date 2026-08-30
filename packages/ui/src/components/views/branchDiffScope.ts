import React from 'react';

export const isBranchScopeAvailable = (
  currentBranch: string | null,
  repositoryDefaultBranch: string | null
): boolean => Boolean(currentBranch)
  && repositoryDefaultBranch !== null
  && currentBranch !== repositoryDefaultBranch;

export const isBranchScopeDefinitelyUnavailable = (
  currentBranch: string | null,
  repositoryDefaultBranch: string | null,
  isBranchStatusResolved: boolean,
  isBranchMetadataLoaded: boolean
): boolean => {
  if (!isBranchStatusResolved) return false;
  if (currentBranch === null) return true;
  if (isBranchMetadataLoaded && repositoryDefaultBranch === null) return true;
  return repositoryDefaultBranch !== null && currentBranch === repositoryDefaultBranch;
};

export const coerceDiffScope = <T extends string>(
  scope: T,
  branchScopeAvailable: boolean
): T | 'working' => (scope === 'branch' && !branchScopeAvailable ? 'working' : scope);

export const branchRangeKey = (directory: string, base: string, head: string): string =>
  JSON.stringify([directory, base, head]);

export const useBoundedDirectoryRetry = (
  directory: string | null,
  isEnabled: boolean,
  isRequestInFlight: boolean,
  hasResult: boolean,
  startRequest: () => void,
  maxAttempts: number
): boolean => {
  const attemptsRef = React.useRef<{ directory: string; attempts: number }>({ directory: '', attempts: 0 });
  const [exhaustedState, setExhaustedState] = React.useState<{ directory: string; exhausted: boolean }>(
    () => ({ directory: '', exhausted: false })
  );
  const startRequestRef = React.useRef(startRequest);
  startRequestRef.current = startRequest;
  const exhausted = Boolean(directory)
    && exhaustedState.directory === directory
    && exhaustedState.exhausted;

  React.useEffect(() => {
    if (!directory || !isEnabled || hasResult || isRequestInFlight) {
      return;
    }
    const attempts = attemptsRef.current.directory === directory
      ? attemptsRef.current.attempts
      : 0;
    if (attempts >= maxAttempts) {
      if (!(exhaustedState.directory === directory && exhaustedState.exhausted)) {
        setExhaustedState({ directory, exhausted: true });
      }
      return;
    }
    attemptsRef.current = { directory, attempts: attempts + 1 };
    startRequestRef.current();
  }, [directory, exhaustedState, hasResult, isEnabled, isRequestInFlight, maxAttempts]);

  return exhausted;
};

export const useRangeKeyedCache = <T>(
  rangeKey: string | null,
  pathsKey: string,
  fetchEntry: ((path: string) => Promise<T>) | null,
  placeholder: T
): ReadonlyMap<string, T> => {
  const [entries, setEntries] = React.useState<Map<string, T>>(() => new Map());
  const entriesRef = React.useRef(entries);
  entriesRef.current = entries;
  const fetchEntryRef = React.useRef(fetchEntry);
  fetchEntryRef.current = fetchEntry;

  const writeEntry = React.useCallback((path: string, value: T | null) => {
    const next = new Map(entriesRef.current);
    if (value === null) {
      if (!next.delete(path)) return;
    } else {
      next.set(path, value);
    }
    entriesRef.current = next;
    setEntries(next);
  }, []);

  React.useEffect(() => {
    if (!rangeKey) return;
    entriesRef.current = new Map();
    setEntries(entriesRef.current);
  }, [rangeKey]);

  React.useEffect(() => {
    const fetcher = fetchEntryRef.current;
    if (!rangeKey || !fetcher || !pathsKey) {
      return;
    }
    let cancelled = false;
    const pendingReservations = new Set<string>();

    for (const path of pathsKey.split('\0')) {
      if (entriesRef.current.has(path)) continue;
      pendingReservations.add(path);
      writeEntry(path, placeholder);
      fetcher(path)
        .then((value) => {
          if (cancelled) return;
          pendingReservations.delete(path);
          writeEntry(path, value);
        })
        .catch(() => {
          if (cancelled) return;
          pendingReservations.delete(path);
          writeEntry(path, null);
        });
    }
    return () => {
      cancelled = true;
      for (const path of pendingReservations) {
        writeEntry(path, null);
      }
    };
  }, [pathsKey, placeholder, rangeKey, writeEntry]);

  return entries;
};
