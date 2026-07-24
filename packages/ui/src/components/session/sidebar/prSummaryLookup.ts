import { getGitHubPrStatusKey } from '@/stores/useGitHubPrStatusStore';

type PrSummaryTarget = {
  readonly directory: string;
  readonly branch: string;
};

type PrSummaryLookup = {
  readonly keys: string[];
  readonly displayKeyByLookupKey: Map<string, string>;
};

export const buildPrSummaryLookup = (targets: readonly PrSummaryTarget[]): PrSummaryLookup => {
  const keys = new Set<string>();
  const displayKeyByLookupKey = new Map<string, string>();

  targets.forEach(({ directory, branch }) => {
    const lookupKey = getGitHubPrStatusKey(directory, branch);
    keys.add(lookupKey);
    displayKeyByLookupKey.set(lookupKey, `${directory}::${branch}`);
  });

  return { keys: [...keys], displayKeyByLookupKey };
};
