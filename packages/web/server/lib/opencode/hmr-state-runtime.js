import { DEFAULT_PROTOCOL_MODE_SERVER_ID, resolveProtocolMode } from './protocol-mode.js';

export const createHmrStateRuntime = (dependencies) => {
  const {
    globalThisLike,
    os,
    processLike,
    stateKey,
  } = dependencies;

  const getInitialOpenCodeWorkingDirectory = () => {
    const configured = typeof processLike.env.OPENCHAMBER_OPENCODE_CWD === 'string'
      ? processLike.env.OPENCHAMBER_OPENCODE_CWD.trim()
      : '';
    return configured || os.homedir();
  };

  const getOrCreateHmrState = () => {
    if (!globalThisLike[stateKey]) {
      globalThisLike[stateKey] = {
        openCodeProcess: null,
        openCodePort: null,
        openCodeWorkingDirectory: getInitialOpenCodeWorkingDirectory(),
        isShuttingDown: false,
        signalsAttached: false,
        userProvidedOpenCodePassword: undefined,
        openCodeAuthPassword: null,
        openCodeAuthSource: null,
      };
    }
    return globalThisLike[stateKey];
  };

  const ensureUserProvidedOpenCodePassword = (hmrState) => {
    if (typeof hmrState.userProvidedOpenCodePassword !== 'undefined') {
      return;
    }
    // Upstream `8dd842a3b` (#138): OpenCode 2 reads OPENCODE_PASSWORD before
    // the legacy OPENCODE_SERVER_PASSWORD, so on the v2 track a user-provided
    // OPENCODE_PASSWORD is the password the managed server actually uses.
    // OpenCode 1.x never reads OPENCODE_PASSWORD — honoring it there would
    // authenticate against a value the server ignores — so the v1 track keeps
    // reading the legacy variable only.
    const candidates = resolveProtocolMode(DEFAULT_PROTOCOL_MODE_SERVER_ID, processLike.env) === 'v2'
      ? [processLike.env.OPENCODE_PASSWORD, processLike.env.OPENCODE_SERVER_PASSWORD]
      : [processLike.env.OPENCODE_SERVER_PASSWORD];
    const initialPassword = candidates
      .map((value) => (typeof value === 'string' ? value.trim() : ''))
      .find((value) => value.length > 0) || '';
    hmrState.userProvidedOpenCodePassword = initialPassword || null;
  };

  const getUserProvidedOpenCodePassword = (hmrState) => (
    typeof hmrState.userProvidedOpenCodePassword === 'string' && hmrState.userProvidedOpenCodePassword.length > 0
      ? hmrState.userProvidedOpenCodePassword
      : null
  );

  const resolveOpenCodeAuthFromState = ({ hmrState, userProvidedOpenCodePassword }) => ({
    openCodeAuthPassword:
      typeof hmrState.openCodeAuthPassword === 'string' && hmrState.openCodeAuthPassword.length > 0
        ? hmrState.openCodeAuthPassword
        : userProvidedOpenCodePassword,
    openCodeAuthSource:
      typeof hmrState.openCodeAuthSource === 'string' && hmrState.openCodeAuthSource.length > 0
        ? hmrState.openCodeAuthSource
        : (userProvidedOpenCodePassword ? 'user-env' : null),
  });

  const syncStateFromRuntime = (hmrState, runtime) => {
    hmrState.openCodeProcess = runtime.openCodeProcess;
    hmrState.openCodePort = runtime.openCodePort;
    hmrState.openCodeBaseUrl = runtime.openCodeBaseUrl;
    hmrState.isShuttingDown = runtime.isShuttingDown;
    hmrState.signalsAttached = runtime.signalsAttached;
    hmrState.openCodeWorkingDirectory = runtime.openCodeWorkingDirectory;
    hmrState.openCodeAuthPassword = runtime.openCodeAuthPassword;
    hmrState.openCodeAuthSource = runtime.openCodeAuthSource;
  };

  const restoreRuntimeFromState = ({ hmrState, userProvidedOpenCodePassword }) => {
    const auth = resolveOpenCodeAuthFromState({ hmrState, userProvidedOpenCodePassword });
    return {
      openCodeProcess: hmrState.openCodeProcess,
      openCodePort: hmrState.openCodePort,
      openCodeBaseUrl: hmrState.openCodeBaseUrl ?? null,
      isShuttingDown: hmrState.isShuttingDown,
      signalsAttached: hmrState.signalsAttached,
      openCodeWorkingDirectory: hmrState.openCodeWorkingDirectory,
      openCodeAuthPassword: auth.openCodeAuthPassword,
      openCodeAuthSource: auth.openCodeAuthSource,
    };
  };

  return {
    getOrCreateHmrState,
    ensureUserProvidedOpenCodePassword,
    getUserProvidedOpenCodePassword,
    resolveOpenCodeAuthFromState,
    syncStateFromRuntime,
    restoreRuntimeFromState,
  };
};
