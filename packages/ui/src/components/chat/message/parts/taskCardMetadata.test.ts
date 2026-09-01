import { describe, expect, test } from 'bun:test';

import { parseOfferedTaskToolPart, parseOpenChamberTaskCard } from './taskCardMetadata';

const validCard = {
  version: 1,
  title: 'Fix stale README badge',
  tldr: 'Update the CI badge link',
  prompt: 'The README CI badge points at the old workflow. Update it.',
  sessionID: 'ses_source',
  directory: '/repo',
  createdAt: '2026-08-31T00:00:00.000Z',
};

const validPart = {
  type: 'tool',
  tool: 'offer_task',
  state: { metadata: { openchamberTaskCard: validCard } },
};

describe('parseOfferedTaskToolPart', () => {
  test('parses an offer_task part with a valid card', () => {
    const card = parseOfferedTaskToolPart(validPart);
    expect(card).not.toBeNull();
    expect(card?.title).toBe('Fix stale README badge');
    expect(card?.prompt).toContain('README');
  });

  test('rejects other tools and non-tool parts', () => {
    expect(parseOfferedTaskToolPart({ ...validPart, tool: 'publish_artifact' })).toBeNull();
    expect(parseOfferedTaskToolPart({ type: 'text', text: 'hi' })).toBeNull();
    expect(parseOfferedTaskToolPart(null)).toBeNull();
  });

  test('rejects malformed card payloads', () => {
    expect(
      parseOfferedTaskToolPart({
        ...validPart,
        state: { metadata: { openchamberTaskCard: { ...validCard, version: 2 } } },
      }),
    ).toBeNull();
    expect(
      parseOfferedTaskToolPart({
        ...validPart,
        state: { metadata: { openchamberTaskCard: { ...validCard, prompt: '' } } },
      }),
    ).toBeNull();
    expect(parseOfferedTaskToolPart({ ...validPart, state: {} })).toBeNull();
  });

  test('treats agent as optional', () => {
    const card = parseOpenChamberTaskCard({
      openchamberTaskCard: { ...validCard, agent: 'plan' },
    });
    expect(card?.agent).toBe('plan');
    expect(parseOpenChamberTaskCard({ openchamberTaskCard: validCard })?.agent).toBeUndefined();
  });
});
