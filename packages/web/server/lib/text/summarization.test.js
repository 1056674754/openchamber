import { afterEach, describe, expect, it, vi } from 'vitest';

import { sanitizeForTTS, summarizeText, generateSessionTitleCandidates } from './summarization.js';

const originalFetch = globalThis.fetch;

describe('text summarization stubs', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('removes code from TTS text before stripping markdown punctuation', () => {
    expect(sanitizeForTTS('Read `const value = 1` aloud')).toBe('Read aloud');
    expect(sanitizeForTTS('Before\n```js\nconst value = 1\n```\nAfter')).toBe('Before After');
  });

  it('does not call the retired zen provider', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const result = await summarizeText({
      text: 'The implementation now correctly loads notification templates before dispatching the notification. It also fetches the latest assistant message when the event payload does not include message parts. This should make completion notifications match user settings.',
      threshold: 0,
      maxLength: 80,
      zenModel: 'gpt-5-nano',
      mode: 'notification',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.summarized).toBe(false);
    expect(result.reason).toBe('Model summarization provider unavailable');
    expect(result.summary).toBe('The implementation now correctly loads notification templates before dispatchin…');
  });

  it('returns local note fallback while provider is unavailable', async () => {
    const result = await summarizeText({
      text: 'First sentence. Second sentence with the useful insight.',
      threshold: 0,
      maxLength: 100,
      mode: 'note',
    });

    expect(result).toMatchObject({
      summary: 'First sentence.',
      summarized: false,
      reason: 'Model summarization provider unavailable',
    });
  });
});

describe('generateSessionTitleCandidates', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('returns local fallback candidates without calling zen', async () => {
    const fetchMock = vi.fn();
    globalThis.fetch = fetchMock;

    const result = await generateSessionTitleCandidates({
      text: 'OAuth token refresh failed. Token lifecycle audit is needed.',
      count: 3,
      maxLength: 60,
      zenModel: 'gpt-5-nano',
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(result.generated).toBe(false);
    expect(result.reason).toBe('Model summarization provider unavailable');
    expect(result.candidates).toContain('OAuth token refresh failed.');
    expect(result.candidates).toContain('Token lifecycle audit is needed.');
  });

  it('truncates local candidates exceeding maxLength', async () => {
    const result = await generateSessionTitleCandidates({
      text: 'This is an extremely long title that goes on and on and on way past the limit.',
      count: 1,
      maxLength: 20,
      zenModel: 'gpt-5-nano',
    });

    expect(result.generated).toBe(false);
    expect(result.candidates).toHaveLength(1);
    expect(result.candidates[0].length).toBeLessThanOrEqual(20);
  });

  it('returns generated=false with reason when text is empty', async () => {
    const result = await generateSessionTitleCandidates({
      text: '   ',
      count: 3,
    });
    expect(result.generated).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.reason).toBe('No text provided');
  });
});
