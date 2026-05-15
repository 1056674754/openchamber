import { afterEach, describe, expect, it, vi } from 'vitest';

import { summarizeText, generateSessionTitleCandidates } from './summarization.js';

const originalFetch = globalThis.fetch;

function stubFetch(fetchMock) {
  globalThis.fetch = fetchMock;
}

describe('text summarization zen requests', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('uses responses endpoint for gpt models', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'Short summary' }],
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await summarizeText({
      text: 'Long text '.repeat(30),
      threshold: 0,
      maxLength: 100,
      zenModel: 'gpt-5-nano',
      mode: 'notification',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/v1/responses',
      expect.objectContaining({
        body: expect.stringContaining('"input"'),
      }),
    );
    expect(result.summary).toBe('Short summary');
  });

  it('uses chat completions endpoint for openai-compatible zen models', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{ message: { content: 'Chat summary' } }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await summarizeText({
      text: 'Long text '.repeat(30),
      threshold: 0,
      maxLength: 100,
      zenModel: 'big-pickle',
      mode: 'notification',
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'https://opencode.ai/zen/v1/chat/completions',
      expect.objectContaining({
        body: expect.stringContaining('"messages"'),
      }),
    );
    expect(result.summary).toBe('Chat summary');
  });

  it('clamps successful model summaries to the requested max length', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'This response is too long' }],
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await summarizeText({
      text: 'Long text '.repeat(30),
      threshold: 0,
      maxLength: 12,
      zenModel: 'gpt-5-nano',
      mode: 'notification',
    });

    expect(result.summary).toBe('This respon');
    expect(result.summary.length).toBeLessThanOrEqual(12);
  });

  it('returns full text when max length is non-finite', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: 'A'.repeat(100) }],
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await summarizeText({
      text: 'Long text '.repeat(30),
      threshold: 0,
      maxLength: Infinity,
      zenModel: 'gpt-5-nano',
      mode: 'notification',
    });

    expect(result.summary).toBe('A'.repeat(100));
  });
});

describe('generateSessionTitleCandidates', () => {
  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('parses a clean JSON array from zen responses endpoint', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: '["Fix OAuth token refresh", "Refactor auth callback loop", "Token lifecycle audit"]',
          }],
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await generateSessionTitleCandidates({
      text: 'User discussed OAuth token refresh issues.',
      count: 3,
      zenModel: 'gpt-5-nano',
    });

    expect(result.generated).toBe(true);
    expect(result.candidates).toHaveLength(3);
    expect(result.candidates[0]).toBe('Fix OAuth token refresh');
    expect(result.candidates[1]).toBe('Refactor auth callback loop');
    expect(result.candidates[2]).toBe('Token lifecycle audit');
  });

  it('strips markdown code fences around JSON', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: '```json\n["Alpha", "Beta", "Gamma"]\n```',
          }],
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await generateSessionTitleCandidates({
      text: 'Conversation text here.',
      count: 3,
      zenModel: 'gpt-5-nano',
    });

    expect(result.generated).toBe(true);
    expect(result.candidates).toEqual(['Alpha', 'Beta', 'Gamma']);
  });

  it('falls back to newline parsing when model returns numbered list', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '1. First title\n2. Second title\n3. Third title',
          },
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await generateSessionTitleCandidates({
      text: 'Conversation text here.',
      count: 3,
      zenModel: 'big-pickle',
    });

    expect(result.generated).toBe(true);
    expect(result.candidates).toEqual(['First title', 'Second title', 'Third title']);
  });

  it('strips leading bullets from newline fallback', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: '- One title\n- Two title\n- Three title',
          },
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await generateSessionTitleCandidates({
      text: 'Conversation text here.',
      count: 3,
      zenModel: 'big-pickle',
    });

    expect(result.candidates).toEqual(['One title', 'Two title', 'Three title']);
  });

  it('strips wrapping quotes from candidates', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: '["\\"Quoted title\\"", "Another one", "Third"]',
          }],
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await generateSessionTitleCandidates({
      text: 'x',
      count: 3,
      zenModel: 'gpt-5-nano',
    });

    expect(result.candidates[0]).toBe('Quoted title');
  });

  it('truncates candidates exceeding maxLength', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{
            type: 'output_text',
            text: '["This is an extremely long title that goes on and on and on way past the limit"]',
          }],
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await generateSessionTitleCandidates({
      text: 'x',
      count: 1,
      maxLength: 20,
      zenModel: 'gpt-5-nano',
    });

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

  it('returns generated=false when zen API fails', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: false,
      status: 500,
      json: async () => ({ error: 'server error' }),
    }));
    stubFetch(fetchMock);

    const result = await generateSessionTitleCandidates({
      text: 'x',
      count: 3,
      zenModel: 'gpt-5-nano',
    });

    expect(result.generated).toBe(false);
    expect(result.candidates).toEqual([]);
    expect(result.reason).toContain('500');
  });

  it('returns generated=false when output is unparseable', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({
        output: [{
          type: 'message',
          content: [{ type: 'output_text', text: '' }],
        }],
      }),
    }));
    stubFetch(fetchMock);

    const result = await generateSessionTitleCandidates({
      text: 'x',
      count: 3,
      zenModel: 'gpt-5-nano',
    });

    expect(result.generated).toBe(false);
    expect(result.candidates).toEqual([]);
  });
});
