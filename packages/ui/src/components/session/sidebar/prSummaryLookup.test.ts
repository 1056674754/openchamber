import { describe, expect, test } from 'bun:test';
import { getGitHubPrStatusKey } from '@/stores/useGitHubPrStatusStore';
import { buildPrSummaryLookup } from './prSummaryLookup';

describe('PR summary lookup', () => {
  test('maps normalized lookup keys back to directory and branch display keys', () => {
    const lookup = buildPrSummaryLookup([
      { directory: '/workspace/project', branch: 'feature/summary' },
    ]);
    const lookupKey = getGitHubPrStatusKey('/workspace/project', 'feature/summary');

    expect(lookup.keys).toEqual([lookupKey]);
    expect(lookup.displayKeyByLookupKey.get(lookupKey)).toBe('/workspace/project::feature/summary');
  });

  test('deduplicates repeated lookup targets', () => {
    const target = { directory: '/workspace/project', branch: 'main' };
    const lookup = buildPrSummaryLookup([target, target]);

    expect(lookup.keys).toHaveLength(1);
    expect(lookup.displayKeyByLookupKey.size).toBe(1);
  });
});
