import { describe, expect, test } from 'bun:test';
import type { Session } from '@opencode-ai/sdk/v2';
import {
  listGlobalSessionPage,
  listGlobalSessionPages,
  type SessionListClient,
  type SessionListRequest,
} from './globalSessions';

const makeSession = (id: string, updated: number): Session => ({
  id,
  slug: id,
  projectID: 'project',
  directory: '/repo',
  title: id,
  version: 'v1',
  time: { created: updated, updated },
});

const makeClient = (
  pages: Array<{ data: Session[]; nextCursor?: number }>,
  requests: SessionListRequest[],
): SessionListClient => ({
  experimental: {
    session: {
      list: async (request) => {
        requests.push(request);
        const page = pages.shift() ?? { data: [] };
        return {
          data: page.data,
          response: {
            headers: new Headers(
              page.nextCursor === undefined
                ? undefined
                : { 'x-next-cursor': String(page.nextCursor) },
            ),
          },
        };
      },
    },
  },
});

describe('global session catalog requests', () => {
  test('initial root page never follows a cursor', async () => {
    const requests: SessionListRequest[] = [];
    const client = makeClient([
      { data: [makeSession('root-new', 20)], nextCursor: 20 },
      { data: [makeSession('root-old', 10)] },
    ], requests);

    const sessions = await listGlobalSessionPage(client, {
      archived: false,
      roots: true,
      pageSize: 200,
    });

    expect(sessions.map((session) => session.id)).toEqual(['root-new']);
    expect(requests).toEqual([{
      archived: false,
      roots: true,
      limit: 200,
    }]);
  });

  test('explicit maintenance scans can still page through all roots', async () => {
    const requests: SessionListRequest[] = [];
    const client = makeClient([
      { data: [makeSession('root-new', 20)], nextCursor: 20 },
      { data: [makeSession('root-old', 10)] },
    ], requests);

    const sessions = await listGlobalSessionPages(client, {
      archived: false,
      roots: true,
      pageSize: 1,
    });

    expect(sessions.map((session) => session.id)).toEqual(['root-new', 'root-old']);
    expect(requests).toHaveLength(3);
    expect(requests[1]?.cursor).toBe(20);
    expect(requests[2]?.cursor).toBe(10);
  });
});
