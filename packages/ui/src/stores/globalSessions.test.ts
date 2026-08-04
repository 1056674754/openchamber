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

const makeArchivedSession = (id: string, updated: number, archived: number): Session => ({
  ...makeSession(id, updated),
  time: { created: updated, updated, archived },
});

describe('listGlobalSessionPages archived boundary', () => {
  test('returns only archived sessions when archived pages are requested', async () => {
    const client: SessionListClient = {
      experimental: {
        session: {
          list: async () => ({
            data: [
              makeSession('ses_active', 20),
              makeArchivedSession('ses_archived', 10, 15),
            ],
            response: { headers: new Headers() },
          }),
        },
      },
    };

    const sessions = await listGlobalSessionPages(client, { archived: true, pageSize: 500 });

    expect(sessions.map((session) => session.id)).toEqual(['ses_archived']);
  });

  test('keeps every record when active pages are requested', async () => {
    const client: SessionListClient = {
      experimental: {
        session: {
          list: async () => ({
            data: [
              makeSession('ses_active_1', 20),
              makeSession('ses_active_2', 10),
            ],
            response: { headers: new Headers() },
          }),
        },
      },
    };

    const sessions = await listGlobalSessionPages(client, { archived: false, pageSize: 500 });

    expect(sessions.map((session) => session.id)).toEqual(['ses_active_1', 'ses_active_2']);
  });

  test('keeps paginating archived pages that are full of non-archived records', async () => {
    const calls: SessionListRequest[] = [];
    const client: SessionListClient = {
      experimental: {
        session: {
          list: async (request) => {
            calls.push(request);
            if (request.cursor === undefined) {
              return {
                data: [
                  makeSession('ses_active_1', 30),
                  makeSession('ses_active_2', 20),
                ],
                response: { headers: new Headers({ 'x-next-cursor': '20' }) },
              };
            }
            return {
              data: [makeArchivedSession('ses_archived', 10, 12)],
              response: { headers: new Headers() },
            };
          },
        },
      },
    };

    const sessions = await listGlobalSessionPages(client, { archived: true, pageSize: 2 });

    expect(calls).toHaveLength(2);
    expect(sessions.map((session) => session.id)).toEqual(['ses_archived']);
  });

  test('reports only accepted records to onPage for archived pages', async () => {
    const pages: string[][] = [];
    const client: SessionListClient = {
      experimental: {
        session: {
          list: async () => ({
            data: [
              makeSession('ses_active', 20),
              makeArchivedSession('ses_archived', 10, 12),
            ],
            response: { headers: new Headers() },
          }),
        },
      },
    };

    await listGlobalSessionPages(client, {
      archived: true,
      pageSize: 500,
      onPage: (sessions) => pages.push(sessions.map((session) => session.id)),
    });

    expect(pages).toEqual([['ses_archived']]);
  });

  test('does not notify onPage for an archived page with no archived records', async () => {
    const pages: string[][] = [];
    const client: SessionListClient = {
      experimental: {
        session: {
          list: async () => ({
            data: [makeSession('ses_active', 20)],
            response: { headers: new Headers() },
          }),
        },
      },
    };

    const sessions = await listGlobalSessionPages(client, {
      archived: true,
      pageSize: 500,
      onPage: (page) => pages.push(page.map((session) => session.id)),
    });

    expect(sessions).toEqual([]);
    expect(pages).toEqual([]);
  });
});
