import { describe, expect, test } from 'bun:test';

import { resolveModelVariant } from './modelVariantResolution';

const variants = { low: {}, medium: {}, high: {} };

describe('resolveModelVariant', () => {
  test('prefers the saved Session variant over Agent and Settings defaults', () => {
    expect(resolveModelVariant({
      variants,
      savedVariant: 'low',
      agentVariant: 'medium',
      defaultVariant: 'high',
    })).toBe('low');
  });

  test('uses the Agent variant when the Session has no valid saved choice', () => {
    expect(resolveModelVariant({
      variants,
      savedVariant: 'missing',
      agentVariant: 'medium',
      defaultVariant: 'high',
    })).toBe('medium');
  });

  test('uses the Settings default when neither Session nor Agent provides a valid choice', () => {
    expect(resolveModelVariant({
      variants,
      agentVariant: 'missing',
      defaultVariant: 'high',
    })).toBe('high');
  });

  test('returns undefined when the model exposes no matching variants', () => {
    expect(resolveModelVariant({
      variants,
      savedVariant: 'missing',
      agentVariant: 'also-missing',
      defaultVariant: 'none',
    })).toBe(undefined);
  });

  test('an explicit "Default" (null saved choice) stops the agent and settings fallbacks', () => {
    expect(resolveModelVariant({
      variants,
      savedVariant: null,
      agentVariant: 'medium',
      defaultVariant: 'high',
    })).toBe(undefined);
  });

  test('an explicit "Default" (null saved choice) wins even with no other fallbacks', () => {
    expect(resolveModelVariant({
      variants,
      savedVariant: null,
    })).toBe(undefined);
  });
});
