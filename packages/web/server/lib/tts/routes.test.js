import { describe, expect, it, vi } from 'vitest';
import express from 'express';
import request from 'supertest';

import { registerTtsRoutes } from './routes.js';

const createApp = (summarize) => {
  const app = express();
  app.use(express.json());
  registerTtsRoutes(app, {
    sayTTSCapability: null,
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
});
