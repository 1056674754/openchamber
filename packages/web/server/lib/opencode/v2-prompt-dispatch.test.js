import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  V2_DIRECTORY_PARAM,
  V2_PROMPT_PATHS,
  hasV2PromptBody,
  isV2PromptTrack,
  planV2PromptDispatch,
  postV2PromptDispatch,
} from './v2-prompt-dispatch.js';

const ENV_KEY = 'OPENCHAMBER_PROTOCOL_MODE';

afterEach(() => {
  delete process.env[ENV_KEY];
});

describe('v2 prompt dispatch planner', () => {
  it('defaults to the v1 track and honours the env override per call', () => {
    expect(isV2PromptTrack()).toBe(false);
    process.env[ENV_KEY] = 'v2';
    expect(isV2PromptTrack()).toBe(true);
    process.env[ENV_KEY] = 'v1';
    expect(isV2PromptTrack()).toBe(false);
  });

  it('maps a full v1 prompt body onto switches, synthetics, and the flat prompt', () => {
    const plan = planV2PromptDispatch({
      model: { providerID: 'anthropic', modelID: 'claude' },
      agent: 'build',
      variant: 'high',
      parts: [
        { type: 'text', text: 'knowledge', synthetic: true, metadata: { openchamberContext: { text: 'k' } } },
        { type: 'text', text: 'user ask' },
        { type: 'file', mime: 'image/png', filename: 'shot.png', url: 'data:image/png;base64,AAAA' },
        { type: 'text', text: 'instructions', synthetic: true },
        { type: 'agent', name: 'reviewer' },
      ],
    });
    expect(plan.model).toEqual({ providerID: 'anthropic', id: 'claude', variant: 'high' });
    expect(plan.agent).toBe('build');
    expect(plan.syntheticInputs).toEqual([
      { text: 'knowledge', metadata: { openchamberContext: { text: 'k' } } },
      { text: 'instructions' },
    ]);
    expect(plan.prompt).toEqual({
      text: 'user ask',
      files: [{ uri: 'data:image/png;base64,AAAA', name: 'shot.png' }],
      agents: [{ name: 'reviewer' }],
    });
    expect(hasV2PromptBody(plan.prompt)).toBe(true);
  });

  it('keeps empty and malformed parts out of the plan', () => {
    const plan = planV2PromptDispatch({
      model: { providerID: 'p', modelID: 'm' },
      parts: [
        { type: 'text', text: '   ' },
        { type: 'file', url: '' },
        { type: 'agent', name: '' },
        null,
        'nope',
      ],
    });
    expect(plan.model).toEqual({ providerID: 'p', id: 'm' });
    expect(plan.agent).toBeUndefined();
    expect(plan.syntheticInputs).toEqual([]);
    expect(plan.prompt).toEqual({ text: '' });
    expect(hasV2PromptBody(plan.prompt)).toBe(false);
  });

  it('plans no switch for the /command string model form', () => {
    const plan = planV2PromptDispatch({ model: 'anthropic/claude', parts: [] });
    expect(plan.model).toBeUndefined();
  });

  it('joins multiple user texts with a blank line', () => {
    const plan = planV2PromptDispatch({
      parts: [{ type: 'text', text: 'first' }, { type: 'text', text: 'second' }],
    });
    expect(plan.prompt.text).toBe('first\n\nsecond');
  });
});

describe('v2 prompt dispatch executor', () => {
  it('switches first, admits synthetics parked, then prompts with queue delivery', async () => {
    const posts = [];
    const post = vi.fn(async (path, body) => {
      posts.push({ path, body });
    });
    await postV2PromptDispatch({
      sessionId: 'ses_1',
      delivery: 'queue',
      post,
      body: {
        model: { providerID: 'anthropic', modelID: 'claude' },
        agent: 'build',
        variant: 'low',
        parts: [
          { type: 'text', text: 'context', synthetic: true },
          { type: 'text', text: 'user ask' },
        ],
      },
    });
    expect(posts.map((entry) => entry.path)).toEqual([
      V2_PROMPT_PATHS.switchModel('ses_1'),
      V2_PROMPT_PATHS.switchAgent('ses_1'),
      V2_PROMPT_PATHS.synthetic('ses_1'),
      V2_PROMPT_PATHS.prompt('ses_1'),
    ]);
    expect(posts[0].body).toEqual({ model: { providerID: 'anthropic', id: 'claude', variant: 'low' } });
    expect(posts[1].body).toEqual({ agent: 'build' });
    expect(posts[2].body).toEqual({ text: 'context', delivery: 'queue', resume: false });
    expect(posts[3].body).toEqual({ text: 'user ask', delivery: 'queue' });
  });

  it('omits absent switches, delivery, and metadata', async () => {
    const posts = [];
    await postV2PromptDispatch({
      sessionId: 'ses x',
      post: async (path, body) => posts.push({ path, body }),
      body: { model: { providerID: 'p', modelID: 'm' }, parts: [{ type: 'text', text: 'go' }] },
    });
    expect(posts.map((entry) => entry.path)).toEqual([
      '/session/ses%20x/model',
      '/session/ses%20x/prompt',
    ]);
    expect(posts[1].body).toEqual({ text: 'go' });
  });

  it('fails loudly when a plan carries neither prompt content nor synthetics', async () => {
    const post = vi.fn(async () => {});
    await expect(postV2PromptDispatch({
      sessionId: 'ses_1',
      post,
      body: { model: { providerID: 'p', modelID: 'm' }, parts: [] },
    })).rejects.toThrow('no prompt content');
    expect(post).toHaveBeenCalledTimes(1);
  });

  it('leaves synthetic-only plans admitted without a prompt', async () => {
    const posts = [];
    await postV2PromptDispatch({
      sessionId: 'ses_1',
      post: async (path, body) => posts.push({ path, body }),
      body: { parts: [{ type: 'text', text: 'note', synthetic: true }] },
    });
    expect(posts.map((entry) => entry.path)).toEqual([V2_PROMPT_PATHS.synthetic('ses_1')]);
  });
});

describe('v2 directory param', () => {
  it('is the v2 location query key', () => {
    expect(V2_DIRECTORY_PARAM).toBe('location[directory]');
  });
});
