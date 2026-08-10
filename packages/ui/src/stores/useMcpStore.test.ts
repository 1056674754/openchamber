import { beforeEach, describe, expect, mock, test } from 'bun:test';

type DirectoryParameters = {
  readonly directory?: string;
};

type ConnectParameters = DirectoryParameters & {
  readonly name: string;
};

type RequestOptions = {
  readonly throwOnError: boolean;
};

const statusCalls: Array<DirectoryParameters | undefined> = [];
const connectCalls: Array<readonly [ConnectParameters, RequestOptions]> = [];
const authenticateCalls: Array<readonly [ConnectParameters, RequestOptions]> = [];

const statusMock = async (parameters?: DirectoryParameters) => {
  statusCalls.push(parameters);
  return {
    data: {
      cognee: { status: 'connected' as const },
    },
  };
};
const connectMock = async (parameters: ConnectParameters, options: RequestOptions) => {
  connectCalls.push([parameters, options]);
  return { data: true };
};
const authenticateMock = async (parameters: ConnectParameters, options: RequestOptions) => {
  authenticateCalls.push([parameters, options]);
  return { data: true };
};

const mcpClient = {
  mcp: {
    status: statusMock,
    connect: connectMock,
    auth: {
      authenticate: authenticateMock,
    },
  },
};

mock.module('./mcpApiClient', () => ({
  getMcpApiClient: () => mcpClient,
}));

const { useMcpStore } = await import('./useMcpStore');

const directory = '/workspace/eduhub';

describe('useMcpStore directory scoping', () => {
  beforeEach(() => {
    statusCalls.length = 0;
    connectCalls.length = 0;
    authenticateCalls.length = 0;
    useMcpStore.setState({
      byDirectory: {},
      diagnosticsByDirectory: {},
      loadingKeys: {},
      lastErrorKeys: {},
    });
  });

  test('refresh requests MCP status for the selected directory', async () => {
    await useMcpStore.getState().refresh({ directory });

    expect(statusCalls).toEqual([{ directory }]);
    expect(useMcpStore.getState().getStatusForDirectory(directory)).toEqual({
      cognee: { status: 'connected' },
    });
  });

  test('connect targets the selected directory before refreshing its status', async () => {
    await useMcpStore.getState().connect('cognee', directory);

    expect(connectCalls).toEqual([[
      { name: 'cognee', directory },
      { throwOnError: true },
    ]]);
    expect(statusCalls).toEqual([{ directory }]);
  });

  test('native authentication targets the selected directory before refreshing its status', async () => {
    await useMcpStore.getState().authenticate('cognee', directory);

    expect(authenticateCalls).toEqual([[
      { name: 'cognee', directory },
      { throwOnError: true },
    ]]);
    expect(statusCalls).toEqual([{ directory }]);
  });
});
