import { afterEach, describe, expect, it, vi } from 'vitest';

import { sanitizeForTTS, summarizeText, generateSessionTitleCandidates } from './summarization.js';

const originalFetch = globalThis.fetch;

describe('text summarization', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('removes code from TTS text before stripping markdown punctuation', () => {
    expect(sanitizeForTTS('Read `const value = 1` aloud')).toBe('Read aloud');
    expect(sanitizeForTTS('Before\n```js\nconst value = 1\n```\nAfter')).toBe('Before After');
  });

  it('uses the session-scoped small model instead of the retired zen provider', async () => {
    const generateText = vi.fn(async () => ({
      text: 'Templates now load before notification dispatch.',
      providerID: 'openai',
      modelID: 'gpt-5-nano',
      source: 'preferred-model',
    }));

    const result = await summarizeText({
      text: 'The implementation now correctly loads notification templates before dispatching the notification. It also fetches the latest assistant message when the event payload does not include message parts. This should make completion notifications match user settings.',
      threshold: 0,
      maxLength: 80,
      zenModel: 'gpt-5-nano',
      mode: 'notification',
      directory: '/tmp/project',
      preferredProviderID: 'openai',
      preferredModelID: 'gpt-5',
      generateText,
    });

    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/tmp/project',
      preferredProviderID: 'openai',
      preferredModelID: 'gpt-5',
      restrictToPreferredProvider: true,
    }));
    expect(result.summarized).toBe(true);
    expect(result.summary).toBe('Templates now load before notification dispatch.');
  });

  it('returns a local note fallback when the small model is unavailable', async () => {
    const result = await summarizeText({
      text: 'First sentence. Second sentence with the useful insight.',
      threshold: 0,
      maxLength: 100,
      mode: 'note',
      generateText: async () => {
        throw new Error('No small model available within the session provider');
      },
    });

    expect(result).toMatchObject({
      summary: 'First sentence.',
      summarized: false,
      reason: 'No small model available within the session provider',
    });
  });
});

describe('generateSessionTitleCandidates', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses titles from the small model and marks generated=true', async () => {
    const generateText = vi.fn(async () => ({
      text: 'OAuth token refresh\nLifecycle audit\nAuth expiry handling',
      providerID: 'openai',
      modelID: 'gpt-5.4-mini',
      source: 'family-scan',
    }));

    const result = await generateSessionTitleCandidates({
      text: 'OAuth token refresh failed. Token lifecycle audit is needed.',
      count: 3,
      maxLength: 60,
      directory: '/tmp/proj',
      preferredProviderID: 'openai',
      preferredModelID: 'gpt-5.4',
      generateText,
    });

    expect(generateText).toHaveBeenCalledWith(expect.objectContaining({
      directory: '/tmp/proj',
      preferredProviderID: 'openai',
      preferredModelID: 'gpt-5.4',
      restrictToPreferredProvider: true,
    }));
    expect(result.generated).toBe(true);
    expect(result.candidates).toEqual([
      'OAuth token refresh',
      'Lifecycle audit',
      'Auth expiry handling',
    ]);
    expect(result.providerID).toBe('openai');
    expect(result.modelID).toBe('gpt-5.4-mini');
  });

  it('returns empty candidates with an explicit reason when small model fails', async () => {
    const generateText = vi.fn(async () => {
      throw Object.assign(new Error('No small model available within the session provider'), {
        statusCode: 404,
      });
    });

    const result = await generateSessionTitleCandidates({
      text: 'OAuth token refresh failed. Token lifecycle audit is needed.',
      count: 3,
      maxLength: 60,
      preferredProviderID: 'anthropic',
      preferredModelID: 'claude-opus-4',
      generateText,
    });

    expect(result.generated).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.reason).toBe('No small model available within the session provider');
    // Must not invent local first-sentence heuristics.
    expect(result.candidates).not.toContain('OAuth token refresh failed.');
  });

  it('treats an empty model response as failure without local heuristics', async () => {
    const generateText = vi.fn(async () => ({
      text: '   \n\n',
      providerID: 'openai',
      modelID: 'gpt-5.4-mini',
      source: 'family-scan',
    }));

    const result = await generateSessionTitleCandidates({
      text: 'This is an extremely long title that goes on and on and on way past the limit.',
      count: 3,
      maxLength: 20,
      generateText,
    });

    expect(result.generated).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.reason).toBe('Small model returned no usable titles');
  });

  it('returns generated=false with reason when text is empty', async () => {
    const generateText = vi.fn();
    const result = await generateSessionTitleCandidates({
      text: '   ',
      count: 3,
      generateText,
    });
    expect(generateText).not.toHaveBeenCalled();
    expect(result.generated).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.reason).toBe('No text provided');
  });

  it('strips numbering and truncates each candidate to maxLength', async () => {
    const generateText = vi.fn(async () => ({
      text: '1. Short title\n2. This title is way too long for the configured limit and must be cut\n3. "Quoted title"',
      providerID: 'google',
      modelID: 'gemini-2.5-flash',
      source: 'family-scan',
    }));

    const result = await generateSessionTitleCandidates({
      text: 'session body',
      count: 3,
      maxLength: 20,
      generateText,
    });

    expect(result.generated).toBe(true);
    expect(result.candidates[0]).toBe('Short title');
    expect(result.candidates[1].length).toBeLessThanOrEqual(20);
    expect(result.candidates[2]).toBe('Quoted title');
  });
});
