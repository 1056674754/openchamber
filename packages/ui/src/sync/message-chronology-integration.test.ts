import { describe, expect, test } from 'bun:test';
import type { Event, Message, Part } from '@opencode-ai/sdk/v2/client';

import { applyDirectoryEvent } from './event-reducer';
import { materializeSessionSnapshots } from './materialization';
import { mergeOlderMessagePage } from './message-page-boundary';
import { mergeOptimisticPage } from './optimistic';
import { INITIAL_STATE } from './types';

const message = (id: string, created: number, role: 'user' | 'assistant' = 'user') => ({
  id, sessionID: 'ses_1', role, time: { created },
}) as Message;
const part = (id: string, messageID = 'msg_1') => ({ id, messageID, sessionID: 'ses_1', type: 'text', text: id }) as Part;

describe('message chronology integration', () => {
  test('event insertion follows creation time and parts preserve arrival order', () => {
    const legacy = message('msg_ffffffffffffLegacy', 100);
    const current = message('msg_000000000000Current', 200, 'assistant');
    const draft = structuredClone({ ...INITIAL_STATE, message: { ses_1: [legacy] }, part: { [current.id]: [part('prt_ffffffffffffLegacy', current.id)] } });
    applyDirectoryEvent(draft, { type: 'message.updated', properties: { info: current } } as Event);
    applyDirectoryEvent(draft, {
      type: 'message.part.updated',
      properties: { part: part('prt_000000000000Current', current.id) },
    } as Event);
    expect(draft.message.ses_1).toEqual([legacy, current]);
    expect(draft.part[current.id].map((item) => item.id)).toEqual(['prt_ffffffffffffLegacy', 'prt_000000000000Current']);
  });

  test('page, materialization, and optimistic merges share one chronology', () => {
    const legacy = message('msg_ffffffffffffLegacy', 100);
    const current = message('msg_000000000000Current', 200);
    const mergedPage = mergeOlderMessagePage(
      { session: [current], part: [], cursor: undefined, complete: true },
      { session: [legacy], part: [], cursor: undefined, complete: true },
    );
    expect(mergedPage.session).toEqual([legacy, current]);

    const materialized = materializeSessionSnapshots({ message: {}, part: {} }, 'ses_1', [
      { info: current, parts: [part('prt_z', current.id), part('prt_a', current.id)] },
      { info: legacy, parts: [] },
    ]);
    expect(materialized.messages).toEqual([legacy, current]);
    expect(materialized.part[current.id].map((item) => item.id)).toEqual(['prt_z', 'prt_a']);

    const optimistic = mergeOptimisticPage(
      { session: [legacy], part: [], complete: true },
      [{ message: current, parts: [] }],
    );
    expect(optimistic.session).toEqual([legacy, current]);
  });
});
