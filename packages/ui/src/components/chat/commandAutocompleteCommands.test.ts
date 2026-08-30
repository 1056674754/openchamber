import { describe, expect, test } from 'bun:test';

import {
  buildCommandAutocompleteEntries,
  buildFallbackCommandAutocompleteEntries,
  type CommandAutocompleteDescriptions,
} from './commandAutocompleteCommands';

const descriptions: CommandAutocompleteDescriptions = {
  init: 'init',
  undo: 'undo',
  redo: 'redo',
  timeline: 'timeline',
  compact: 'compact',
  btw: 'btw',
  summary: 'summary',
  workspaceReview: 'workspaceReview',
  handoffReview: 'handoffReview',
  featurePlan: 'featurePlan',
  craftGoal: 'craftGoal',
  scheduleTask: 'scheduleTask',
  catchUp: 'catchUp',
  debug: 'debug',
  weigh: 'weigh',
  explore: 'explore',
};

const commonOptions = {
  searchQuery: '',
  hasSession: true,
  hasMessagesInCurrentSession: true,
  canStartSessionCommand: true,
  canUseReviewHandoffFlow: true,
  canUseCraftGoal: true,
  descriptions,
};

describe('command autocomplete built-ins', () => {
  test('includes btw only when a parent session exists', () => {
    const withSession = buildFallbackCommandAutocompleteEntries({
      ...commonOptions,
      canUseScheduleTask: true,
    });
    const withoutSession = buildFallbackCommandAutocompleteEntries({
      ...commonOptions,
      hasSession: false,
      canUseScheduleTask: true,
    });

    expect(withSession.some((entry) => entry.name === 'btw')).toBe(true);
    expect(withoutSession.some((entry) => entry.name === 'btw')).toBe(false);
  });

  test('includes schedule-task when the current runtime supports it', () => {
    // Given
    const options = {
      ...commonOptions,
      commandsWithMetadata: [],
      skills: [],
      canUseScheduleTask: true,
    };

    // When
    const entries = buildCommandAutocompleteEntries(options);

    // Then
    expect(entries.some((entry) => entry.name === 'schedule-task')).toBe(true);
  });

  test('excludes schedule-task when the current runtime cannot create scheduled tasks', () => {
    // Given
    const options = {
      ...commonOptions,
      canUseScheduleTask: false,
    };

    // When
    const entries = buildFallbackCommandAutocompleteEntries(options);

    // Then
    expect(entries.some((entry) => entry.name === 'schedule-task')).toBe(false);
  });
});
