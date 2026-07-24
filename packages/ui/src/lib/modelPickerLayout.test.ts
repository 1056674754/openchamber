import { describe, expect, test } from 'bun:test';
import { DEFAULT_SERVER_ID } from '@/lib/opencode/server-registry';
import {
  getModelPickerLayout,
  migrateLegacyCollapsedProviders,
  migrateModelPickerLayoutState,
  modelPickerProviderSectionKey,
  sanitizeModelPickerLayoutByServerId,
  setCollapsedSectionKeys,
  sortProvidersByOrder,
  toggleCollapsedSectionKey,
} from '@/lib/modelPickerLayout';

describe('modelPickerLayout', () => {
  test('migrates legacy bare provider IDs into section keys', () => {
    expect(migrateLegacyCollapsedProviders(['openai', 'favorites', 'provider:anthropic'])).toEqual([
      'provider:openai',
      'favorites',
      'provider:anthropic',
    ]);
  });

  test('migrates flat collapsedModelProviders into the default server bucket', () => {
    const migrated = migrateModelPickerLayoutState({
      collapsedModelProviders: ['openai'],
    });

    expect(migrated[DEFAULT_SERVER_ID]).toEqual({
      providerOrder: [],
      collapsedProviders: ['provider:openai'],
    });
  });

  test('does not overwrite an existing default collapsed list during migration', () => {
    const migrated = migrateModelPickerLayoutState({
      modelPickerLayoutByServerId: {
        [DEFAULT_SERVER_ID]: {
          providerOrder: ['anthropic'],
          collapsedProviders: ['favorites'],
        },
      },
      collapsedModelProviders: ['openai'],
    });

    expect(migrated[DEFAULT_SERVER_ID]).toEqual({
      providerOrder: ['anthropic'],
      collapsedProviders: ['favorites'],
    });
  });

  test('keeps layout maps isolated per serverId', () => {
    const sanitized = sanitizeModelPickerLayoutByServerId({
      [DEFAULT_SERVER_ID]: {
        providerOrder: ['openai', 'openai', 'anthropic'],
        collapsedProviders: ['favorites'],
      },
      remote: {
        providerOrder: ['remote-provider'],
        collapsedProviders: ['provider:remote-provider'],
      },
      '  ': {
        providerOrder: ['ignored'],
        collapsedProviders: [],
      },
    });

    expect(sanitized[DEFAULT_SERVER_ID]?.providerOrder).toEqual(['openai', 'anthropic']);
    expect(sanitized.remote?.providerOrder).toEqual(['remote-provider']);
    expect(getModelPickerLayout(sanitized, 'remote').collapsedProviders).toEqual([
      'provider:remote-provider',
    ]);
    expect(getModelPickerLayout(sanitized, DEFAULT_SERVER_ID).collapsedProviders).toEqual([
      'favorites',
    ]);
  });

  test('sorts known providers first and appends unknowns', () => {
    const providers = [
      { id: 'c' },
      { id: 'a' },
      { id: 'b' },
    ];

    expect(sortProvidersByOrder(providers, ['b', 'a']).map((provider) => provider.id)).toEqual([
      'b',
      'a',
      'c',
    ]);
  });

  test('toggles and batches collapsed section keys', () => {
    expect(toggleCollapsedSectionKey(['favorites'], 'favorites')).toEqual([]);
    expect(toggleCollapsedSectionKey([], modelPickerProviderSectionKey('openai'))).toEqual([
      'provider:openai',
    ]);
    expect(setCollapsedSectionKeys(['favorites'], ['recent', 'favorites'], true)).toEqual([
      'recent',
      'favorites',
    ]);
    expect(setCollapsedSectionKeys(['favorites', 'recent'], ['favorites'], false)).toEqual([
      'recent',
    ]);
  });
});
