import { beforeEach, describe, expect, mock, test } from 'bun:test';
import type { Message, Session } from '@opencode-ai/sdk/v2';

const parentId = 'parent-1';
const forkId = 'fork-1';
const directory = '/workspace/app';
let sessionServerId: string | null = 'default';
let parentMessages: Message[] = [];
let forkResponse: Session | null = null;
let sendError: Error | null = null;
const forkCalls: unknown[] = [];
const patchCalls: Array<{ sessionId: string; directory: string }> = [];
const deleteCalls: string[] = [];
const sendCalls: unknown[][] = [];
const registered: Array<{ sessionId: string; directory: string }> = [];
const indexed: Array<{ sessionId: string; serverId: string }> = [];
const metadataBySession = new Map<string, Record<string, unknown>>();
const childState = { session: [] as Session[] };
const childStore = {
  getState: () => childState,
  setState: (patch: { session?: Session[] }) => {
    if (patch.session) childState.session = patch.session;
  },
};
const manager = { ensureChild: mock(() => childStore) };

const sessionFork = mock(async (input: unknown) => {
  forkCalls.push(input);
  return { data: forkResponse };
});
const sessionMessages = mock(async () => ({
  data: [{ info: message('cloned-boundary', 'user', 19), parts: [] }],
}));

mock.module('@/lib/opencode/server-registry', () => ({
  DEFAULT_SERVER_ID: 'default',
  serverRegistry: {
    getServerForSession: mock(() => sessionServerId),
    indexSession: mock((sessionId: string, serverId: string) => indexed.push({ sessionId, serverId })),
  },
}));

mock.module('@/stores/useGlobalSessionsStore', () => ({
  useGlobalSessionsStore: {
    getState: () => ({ upsertSession: mock(() => undefined) }),
  },
}));

mock.module('@/sync/multi-server-registry', () => ({
  getSyncStoresForServer: mock(() => manager),
}));

mock.module('@/sync/sync-refs', () => ({
  getSyncChildStores: mock(() => manager),
  getSyncMessages: mock(() => parentMessages),
  registerSessionDirectory: mock((sessionId: string, targetDirectory: string) => registered.push({ sessionId, directory: targetDirectory })),
}));

mock.module('@/sync/session-actions', () => ({
  waitForConnectionOrThrow: mock(async () => undefined),
  resolveSdkForDirectory: mock(() => ({ session: { fork: sessionFork, messages: sessionMessages } })),
  patchSessionMetadata: mock(async (
    sessionId: string,
    targetDirectory: string,
    transform: (metadata: Record<string, unknown>) => Record<string, unknown>,
  ) => {
    patchCalls.push({ sessionId, directory: targetDirectory });
    const metadata = transform(metadataBySession.get(sessionId) ?? {});
    metadataBySession.set(sessionId, metadata);
    const base = sessionId === forkId ? forkResponse : { id: sessionId, directory: targetDirectory };
    return base ? { ...base, metadata } as Session : null;
  }),
  updateSessionTitle: mock(async () => undefined),
  deleteSession: mock(async (sessionId: string) => {
    deleteCalls.push(sessionId);
    return true;
  }),
}));

mock.module('@/sync/session-ui-store', () => ({
  useSessionUIStore: {
    getState: () => ({
      sendMessage: mock(async (...args: unknown[]) => {
        sendCalls.push(args);
        if (sendError) throw sendError;
      }),
      setCurrentSession: mock(() => undefined),
    }),
  },
}));

const {
  BTW_BOUNDARY_INSTRUCTION,
  BTW_PROMOTION_NOTICE,
  filterBtwTailMessages,
  findLastCompletedAssistantMessageID,
  getBtwSyntheticParts,
  startBtwSession,
} = await import('./btw');
const { useBtwStore } = await import('@/stores/useBtwStore');

const message = (id: string, role: 'user' | 'assistant', created: number, completed?: number): Message => ({
  id,
  sessionID: parentId,
  role,
  time: { created, ...(completed === undefined ? {} : { completed }) },
} as Message);

const sessionWith = (metadata: unknown): Session => ({ id: 'session', metadata }) as Session;

beforeEach(() => {
  sessionServerId = 'default';
  parentMessages = [];
  forkResponse = { id: forkId, directory: '/workspace/canonical' } as Session;
  sendError = null;
  forkCalls.length = 0;
  patchCalls.length = 0;
  deleteCalls.length = 0;
  sendCalls.length = 0;
  registered.length = 0;
  indexed.length = 0;
  metadataBySession.clear();
  childState.session = [];
  useBtwStore.setState({ byParent: {} });
});

describe('btw chronology', () => {
  test('finds the last completed assistant by time, not input or id order', () => {
    const result = findLastCompletedAssistantMessageID([
      message('msg_000', 'assistant', 30),
      message('msg_zzz', 'assistant', 20, 21),
      message('msg_aaa', 'assistant', 10, 11),
    ]);
    expect(result).toBe('msg_zzz');
  });

  test('tail slicing survives id rollover and fails closed when the marker is absent', () => {
    const inherited = { info: message('msg_zzz', 'assistant', 20, 21), parts: [] };
    const later = { info: message('msg_000', 'assistant', 30, 31), parts: [] };
    const earlier = { info: message('msg_aaa', 'user', 10), parts: [] };
    expect(filterBtwTailMessages([later, earlier, inherited], 'msg_zzz').map((record) => record.info.id)).toEqual(['msg_000']);
    expect(filterBtwTailMessages([later, earlier], 'missing')).toEqual([]);
  });
});

describe('btw synthetic instructions', () => {
  test('live and promoted side sessions receive different instructions', () => {
    expect(getBtwSyntheticParts(sessionWith({ openchamber: { kind: 'btw', originalSessionID: parentId } }))).toEqual([
      { text: BTW_BOUNDARY_INSTRUCTION, synthetic: true },
    ]);
    expect(getBtwSyntheticParts(sessionWith({ openchamber: { btwPromoted: true } }))).toEqual([
      { text: BTW_PROMOTION_NOTICE, synthetic: true },
    ]);
    expect(getBtwSyntheticParts(sessionWith({}))).toEqual([]);
  });
});

describe('startBtwSession', () => {
  test('forks at the last completed turn, marks before insert, links parent, and sends to canonical authority', async () => {
    parentMessages = [
      message('user-1', 'user', 10),
      message('assistant-complete', 'assistant', 20, 21),
      message('user-active', 'user', 30),
      message('assistant-active', 'assistant', 40),
    ];

    const result = await startBtwSession({
      parentSessionId: parentId,
      question: '  What does this API do?  ',
      directory,
      providerID: 'openai',
      modelID: 'gpt-5.6-sol',
      agent: 'Sisyphus - ultraworker',
    });

    expect(result.id).toBe(forkId);
    expect(forkCalls).toEqual([{
      sessionID: parentId,
      directory,
      messageID: 'assistant-complete',
    }]);
    expect(registered).toEqual([{ sessionId: forkId, directory: '/workspace/canonical' }]);
    expect(indexed).toEqual([{ sessionId: forkId, serverId: 'default' }]);
    expect((childState.session[0] as Session & { metadata?: unknown }).metadata).toEqual({
      openchamber: {
        kind: 'btw',
        originalSessionID: parentId,
        btwBoundaryMessageID: 'cloned-boundary',
      },
    });
    expect(metadataBySession.get(parentId)).toEqual({ openchamber: { btwSessionID: forkId } });
    expect(sendCalls).toHaveLength(1);
    expect(sendCalls[0]?.[0]).toBe('What does this API do?');
    expect(sendCalls[0]?.[6]).toEqual([{ text: BTW_BOUNDARY_INSTRUCTION, synthetic: true }]);
    expect(sendCalls[0]?.[9]).toEqual({
      sessionId: forkId,
      directory: '/workspace/canonical',
      serverId: 'default',
    });
  });

  test('unlinks and deletes a fork whose first send fails', async () => {
    parentMessages = [message('assistant-complete', 'assistant', 20, 21)];
    sendError = new Error('send failed');

    await expect(startBtwSession({
      parentSessionId: parentId,
      question: 'Side question',
      directory,
      providerID: 'openai',
      modelID: 'gpt-5.6-sol',
    })).rejects.toThrow('send failed');

    expect(metadataBySession.get(parentId)).toEqual({});
    expect(deleteCalls).toEqual([forkId]);
    expect(useBtwStore.getState().byParent[parentId]).toBeUndefined();
  });
});
