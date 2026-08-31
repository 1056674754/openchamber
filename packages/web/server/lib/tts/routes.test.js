import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { registerTtsRoutes } from './routes.js';

const createApp = (summarize, sayTTSCapability = null) => {
  const app = express();
  app.use(express.json());
  registerTtsRoutes(app, {
    sayTTSCapability,
    summarize,
  });
  return app;
};

describe('tts routes', () => {
  it('forwards directory and preferred model authority to summarization', async () => {
    const summarize = vi.fn(async () => ({
      summary: 'Useful insight: Second sentence.',
      summarized: true,
      providerID: 'openai',
      modelID: 'gpt-5-nano',
    }));
    const response = await request(createApp(summarize))
      .post('/api/text/summarize')
      .send({
        text: 'First sentence. Second sentence with the useful insight.',
        threshold: 0,
        maxLength: 100,
        mode: 'note',
        directory: '/tmp/project',
        preferredProviderID: 'openai',
        preferredModelID: 'gpt-5',
      });

    expect(response.status).toBe(200);
    expect(summarize).toHaveBeenCalledWith({
      text: 'First sentence. Second sentence with the useful insight.',
      threshold: 0,
      maxLength: 100,
      mode: 'note',
      directory: '/tmp/project',
      preferredProviderID: 'openai',
      preferredModelID: 'gpt-5',
    });
    expect(response.body).toMatchObject({
      summary: 'Useful insight: Second sentence.',
      summarized: true,
    });
  });

  it('returns a sanitized fallback when summarization fails', async () => {
    const response = await request(createApp(async () => {
      throw new Error('Small model unavailable');
    }))
      .post('/api/text/summarize')
      .send({
        text: 'Notification text that should fall back cleanly.',
        threshold: 0,
        maxLength: 100,
        mode: 'notification',
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      summary: 'Notification text that should fall back cleanly.',
      summarized: false,
      reason: 'Small model unavailable',
    });
  });

  it('switches the say voice to the language of the text when asked to', async () => {
    const capability = Promise.resolve({
      available: true,
      voices: [
        { name: 'Samantha', locale: 'en_US' },
        { name: 'Lesya', locale: 'uk_UA' },
        { name: 'Lesya (Enhanced)', locale: 'uk_UA' },
      ],
    });
    const app = createApp(async () => ({}), capability);
    const response = await request(app)
      .post('/api/tts/say/speak')
      .send({ text: 'Привіт! Це відповідь українською мовою, і вона досить довга.', voice: 'Samantha', language: 'auto' });

    // On macOS the route synthesizes; elsewhere it refuses before running say.
    // Either way the chosen voice must be the Ukrainian one when the platform
    // allows the request to proceed.
    if (process.platform === 'darwin') {
      expect(response.status).toBe(200);
      expect(response.headers['x-speech-voice']).toBe('Lesya (Enhanced)');
      expect(response.headers['x-speech-language']).toBe('uk');
    } else {
      expect(response.status).toBe(503);
    }
  });
});
