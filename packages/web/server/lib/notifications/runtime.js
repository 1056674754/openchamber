import { isEnterpriseMode } from '../enterprise-mode.js';

const pushPayloadForEnterpriseMode = (payload) => {
  if (!isEnterpriseMode()) return payload;
  // Push leaves through the browser vendor's push service. It is encrypted,
  // but enterprise mode keeps conversation content off every channel it does
  // not control: the title and the deep link only.
  const { body: _body, ...rest } = payload ?? {};
  return { ...rest, body: '' };
};

export const createNotificationTriggerRuntime = (deps) => {
  const {
    readSettingsFromDisk,
    prepareNotificationLastMessage,
    buildTemplateVariables,
    extractLastMessageText,
    fetchLastAssistantMessageText,
    resolveNotificationTemplate,
    shouldApplyResolvedTemplateMessage,
    emitDesktopNotification,
    broadcastUiNotification,
    sendPushToAllUiSessions,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
  } = deps;

  let getIsWindowFocused = typeof deps.getIsWindowFocused === 'function'
    ? deps.getIsWindowFocused
    : null;
  // Enterprise-gated push fanout: conversation-derived text stays off the wire.
  const pushToUiSessions = (payload, options) => (
    sendPushToAllUiSessions?.(pushPayloadForEnterpriseMode(payload), options)
  );

  let getIsSessionAutoAccepting = typeof deps.getIsSessionAutoAccepting === 'function'
    ? deps.getIsSessionAutoAccepting
    : null;

  const setGetIsWindowFocused = (cb) => {
    getIsWindowFocused = typeof cb === 'function' ? cb : null;
  };
  const setGetIsSessionAutoAccepting = (cb) => {
    getIsSessionAutoAccepting = typeof cb === 'function' ? cb : null;
  };

  const PUSH_READY_COOLDOWN_MS = 5000;
  const PUSH_QUESTION_DEBOUNCE_MS = 500;
  const PUSH_PERMISSION_DEBOUNCE_MS = 500;
  const pushQuestionDebounceTimers = new Map();
  const pushPermissionDebounceTimers = new Map();
  const notifiedPermissionRequests = new Set();
  const lastReadyNotificationAt = new Map();
  const lastErrorNotificationAt = new Map();

  // Cache the last message.updated payload per session so the session.idle
  // handler can send a notification with the correct template variables
  // (mode, modelID, path, etc.) which session.idle events don't carry.
  const pendingCompletionPayloads = new Map();

  const sessionParentIdCache = new Map();
  const SESSION_PARENT_CACHE_TTL_MS = 60 * 1000;

  // Sessions where the client has enabled Permission Auto-Accept. Mirrored
  // from the client-side permissionStore via POST /api/notifications/auto-accept
  // so the server can suppress permission notifications BEFORE dispatch (the
  // 500ms debounce race otherwise leaks notifications for auto-accepted
  // permissions when the replied round-trip is slower than the debounce).
  const autoAcceptingSessions = new Set();
  const setAutoAcceptSession = (sessionId, enabled) => {
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    if (enabled) {
      autoAcceptingSessions.add(sessionId);
    } else {
      autoAcceptingSessions.delete(sessionId);
    }
  };

  const buildSessionDeepLinkUrl = (sessionId) => {
    if (!sessionId || typeof sessionId !== 'string') {
      return '/';
    }
    return `/?session=${encodeURIComponent(sessionId)}`;
  };

  const getSessionParentCacheKey = (sessionId, directory) => `${directory || ''}\0${sessionId}`;

  const getCachedSessionParentId = (sessionId, directory) => {
    const cacheKey = getSessionParentCacheKey(sessionId, directory);
    const entry = sessionParentIdCache.get(cacheKey);
    if (!entry) return undefined;
    if (Date.now() - entry.at > SESSION_PARENT_CACHE_TTL_MS) {
      sessionParentIdCache.delete(cacheKey);
      return undefined;
    }
    return entry.parentID;
  };

  const setCachedSessionParentId = (sessionId, directory, parentID) => {
    sessionParentIdCache.set(getSessionParentCacheKey(sessionId, directory), {
      parentID: parentID ?? null,
      at: Date.now(),
    });
  };

  const getParentIdFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return undefined;
    if (payload.type !== 'session.created' && payload.type !== 'session.updated') return undefined;
    const parentID = payload.properties?.info?.parentID ?? null;
    return typeof parentID === 'string' && parentID.length > 0 ? parentID : null;
  };

  const maybeCacheSessionParentFromPayload = (payload) => {
    const sessionId = extractSessionIdFromPayload(payload);
    if (typeof sessionId !== 'string' || sessionId.length === 0) return;
    const directory = extractDirectoryFromPayload(payload);
    const parentID = getParentIdFromPayload(payload);
    if (parentID === undefined) return;
    setCachedSessionParentId(sessionId, directory, parentID);
  };

  const fetchSessionParentId = async (sessionId, directory) => {
    if (!sessionId) return undefined;

    const cached = getCachedSessionParentId(sessionId, directory);
    if (cached !== undefined) return cached;

    try {
      const base = buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}`, '');
      const url = directory ? `${base}?directory=${encodeURIComponent(directory)}` : base;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getOpenCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) {
        return undefined;
      }
      const session = await response.json().catch(() => null);
      if (!session || typeof session !== 'object') {
        return undefined;
      }

      const parentID = typeof session.parentID === 'string' && session.parentID.length > 0
        ? session.parentID
        : null;
      setCachedSessionParentId(sessionId, directory, parentID);
      return parentID;
    } catch {
      return undefined;
    }
  };

  // Mirrors client-side autoRespondsPermission: a session auto-accepts if it
  // OR any ancestor is flagged. Walks the parent chain via fetchSessionParentId.
  const isSessionAutoAccepting = async (sessionId, directory) => {
    if (!sessionId || autoAcceptingSessions.size === 0) return false;
    let current = sessionId;
    const seen = new Set();
    while (current && !seen.has(current)) {
      if (autoAcceptingSessions.has(current)) return true;
      seen.add(current);
      const parent = await fetchSessionParentId(current, directory);
      if (!parent) return false;
      current = parent;
    }
    return false;
  };

  const extractSessionIdFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return null;
    const props = payload.properties;
    const info = props?.info;
    const sessionId =
      info?.sessionID ??
      info?.sessionId ??
      props?.sessionID ??
      props?.sessionId ??
      props?.session ??
      null;
    return typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : null;
  };

  const extractDirectoryFromPayload = (payload) => {
    if (!payload || typeof payload !== 'object') return undefined;
    const props = payload.properties;
    const directory = props?.directory ?? props?.info?.directory;
    if (typeof directory !== 'string') return undefined;
    const trimmed = directory.trim();
    return trimmed.length > 0 ? trimmed : undefined;
  };

  const formatMode = (raw) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    const normalized = value.length > 0 ? value : 'agent';
    return normalized
      .split(/[-_\s]+/)
      .filter(Boolean)
      .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
      .join(' ');
  };

  const formatModelId = (raw) => {
    const value = typeof raw === 'string' ? raw.trim() : '';
    if (!value) {
      return 'Assistant';
    }

    const tokens = value.split(/[-_]+/).filter(Boolean);
    const result = [];
    for (let i = 0; i < tokens.length; i += 1) {
      const current = tokens[i];
      const next = tokens[i + 1];
      if (/^\d+$/.test(current) && next && /^\d+$/.test(next)) {
        result.push(`${current}.${next}`);
        i += 1;
        continue;
      }
      result.push(current);
    }

    return result
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(' ');
  };

  // A session with an ACTIVE goal suppresses per-turn ready notifications;
  // the session-goal runtime sends its own notification when the goal
  // settles. Fetch failures fall through to normal notification behavior.
  const hasActiveSessionGoal = async (sessionId, directory) => {
    if (!sessionId) return false;
    try {
      const base = buildOpenCodeUrl(`/session/${encodeURIComponent(sessionId)}`, '');
      const url = directory ? `${base}?directory=${encodeURIComponent(directory)}` : base;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          Accept: 'application/json',
          ...getOpenCodeAuthHeaders(),
        },
        signal: AbortSignal.timeout(2000),
      });
      if (!response.ok) return false;
      const session = await response.json().catch(() => null);
      const goal = session?.metadata?.openchamber?.goal;
      return Boolean(goal && typeof goal === 'object' && goal.status === 'active');
    } catch {
      return false;
    }
  };

  const sendCompletionNotification = async (payload, sessionId, directory) => {
    const info = payload.properties?.info;
    const settings = await readSettingsFromDisk();

    if (settings.notifyOnCompletion === false) {
      return;
    }

    if (settings.notifyOnSubtasks === false) {
      const parentID = await fetchSessionParentId(sessionId, directory);
      if (parentID !== null) {
        return;
      }
    }

    // While a goal drives the session, per-turn "ready" notifications are
    // noise produced by the goal loop itself — the goal's own settle
    // notification (complete/blocked/budget) is the final word instead.
    const notificationDirectory = directory
      || (typeof payload?.properties?.directory === 'string' ? payload.properties.directory : '');
    if (await hasActiveSessionGoal(sessionId, notificationDirectory)) {
      return;
    }

    if (settings.notificationMode !== 'always' && getIsWindowFocused?.()) {
      return;
    }

    const now = Date.now();
    const lastAt = lastReadyNotificationAt.get(sessionId) ?? 0;
    if (now - lastAt < PUSH_READY_COOLDOWN_MS) {
      return;
    }
    lastReadyNotificationAt.set(sessionId, now);

    let title = `${formatMode(info?.mode)} agent is ready`;
    let body = `${formatModelId(info?.modelID)} completed the task`;

    try {
      const templates = settings.notificationTemplates || {};
      const isSubtask = await fetchSessionParentId(sessionId, directory);
      const completionTemplate = isSubtask && settings.notifyOnSubtasks !== false
        ? (templates.subtask || templates.completion || { title: '{agent_name} is ready', message: '{model_name} completed the task' })
        : (templates.completion || { title: '{agent_name} is ready', message: '{model_name} completed the task' });

      const variables = await buildTemplateVariables(payload, sessionId);

      console.log('[Notification:DEBUG:variables]', JSON.stringify({
        project_name: variables.project_name,
        worktree: variables.worktree,
        branch: variables.branch,
        session_name: variables.session_name,
        agent_name: variables.agent_name,
        isSubtask: !!isSubtask,
        completionTemplateTitle: completionTemplate.title,
      }));

      const messageId = info?.id;
      let lastMessage = extractLastMessageText(payload);
      if (!lastMessage) {
        lastMessage = await fetchLastAssistantMessageText(sessionId, messageId);
      }

      variables.last_message = await prepareNotificationLastMessage({
        message: lastMessage,
        settings,
      });

      const resolvedTitle = resolveNotificationTemplate(completionTemplate.title, variables);
      const resolvedBody = resolveNotificationTemplate(completionTemplate.message, variables);
      if (resolvedTitle) title = resolvedTitle;
      if (shouldApplyResolvedTemplateMessage(completionTemplate.message, resolvedBody, variables)) body = resolvedBody;
    } catch (error) {
      console.warn('[Notification] Template resolution failed, using defaults:', error?.message || error);
    }

    if (settings.nativeNotificationsEnabled) {
      const notificationPayload = {
        title,
        body,
        tag: `ready-${sessionId}`,
        kind: 'ready',
        sessionId,
        requireHidden: settings.notificationMode !== 'always',
      };
      const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
      broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
    }

    await pushToUiSessions(
      {
        title,
        body,
        tag: `ready-${sessionId}`,
        data: {
          url: buildSessionDeepLinkUrl(sessionId),
          sessionId,
          type: 'ready',
        },
      },
      { requireNoSse: true },
    );
  };

  const maybeSendPushForTrigger = async (payload) => {
    if (!payload || typeof payload !== 'object') {
      return;
    }

    maybeCacheSessionParentFromPayload(payload);

    const sessionId = extractSessionIdFromPayload(payload);
    const notificationDirectory = extractDirectoryFromPayload(payload);
    if (payload.type === 'session.idle' && sessionId) {
      const cacheKey = getSessionParentCacheKey(sessionId, notificationDirectory);
      const cached = pendingCompletionPayloads.get(cacheKey);
      pendingCompletionPayloads.delete(cacheKey);
      await sendCompletionNotification(cached ?? {
        ...payload,
        type: 'message.updated',
        properties: {
          ...payload.properties,
          info: {
            sessionID: sessionId,
            role: 'assistant',
            finish: 'stop',
          },
        },
      }, sessionId, notificationDirectory);
      return;
    }

    if (payload.type === 'session.error' && sessionId) {
      const cacheKey = getSessionParentCacheKey(sessionId, notificationDirectory);
      pendingCompletionPayloads.delete(cacheKey);
      const error = payload.properties?.error;
      let errorText = '';
      if (typeof error?.data?.message === 'string') {
        errorText = error.data.message;
      } else if (typeof error?.message === 'string') {
        errorText = error.message;
      } else if (typeof error === 'string') {
        errorText = error;
      }
      await maybeSendPushForTrigger({
        ...payload,
        type: 'message.updated',
        properties: {
          ...payload.properties,
          info: {
            sessionID: sessionId,
            role: 'assistant',
            finish: 'error',
            ...(errorText ? { parts: [{ type: 'text', text: errorText }] } : {}),
          },
        },
      });
      return;
    }

    if (payload.type === 'message.updated') {
      const info = payload.properties?.info;
      if (info?.role === 'assistant' && info?.finish === 'stop' && sessionId) {
        const settings = await readSettingsFromDisk();

        if (settings.notifyOnSubtasks === false) {
          const parentIDFromPayload = getParentIdFromPayload(payload);
          const parentID = parentIDFromPayload !== undefined
            ? parentIDFromPayload
            : await fetchSessionParentId(sessionId, notificationDirectory);

          if (parentID !== null) {
            return;
          }
        }

        if (settings.notifyOnCompletion === false) {
          return;
        }

        // Goal loop turns produce idle/ready noise; settle notify is the signal.
        if (await hasActiveSessionGoal(sessionId, notificationDirectory)) {
          return;
        }

        pendingCompletionPayloads.set(
          getSessionParentCacheKey(sessionId, notificationDirectory),
          payload,
        );

        if (settings.notificationMode !== 'always' && getIsWindowFocused?.()) {
          return;
        }

        const now = Date.now();
        const lastAt = lastReadyNotificationAt.get(sessionId) ?? 0;
        if (now - lastAt < PUSH_READY_COOLDOWN_MS) {
          return;
        }
        lastReadyNotificationAt.set(sessionId, now);

        let title = `${formatMode(info?.mode)} agent is ready`;
        let body = `${formatModelId(info?.modelID)} completed the task`;

        try {
          const templates = settings.notificationTemplates || {};
          const isSubtask = await fetchSessionParentId(sessionId, notificationDirectory);
          const completionTemplate = isSubtask && settings.notifyOnSubtasks !== false
            ? (templates.subtask || templates.completion || { title: '{agent_name} is ready', message: '{model_name} completed the task' })
            : (templates.completion || { title: '{agent_name} is ready', message: '{model_name} completed the task' });

          const variables = await buildTemplateVariables(payload, sessionId);

          const messageId = info?.id;
          let lastMessage = extractLastMessageText(payload);
          if (!lastMessage) {
            lastMessage = await fetchLastAssistantMessageText(sessionId, messageId);
          }

          variables.last_message = await prepareNotificationLastMessage({
            message: lastMessage,
            settings,
          });

          const resolvedTitle = resolveNotificationTemplate(completionTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(completionTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(completionTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Template resolution failed, using defaults:', error?.message || error);
        }

        if (settings.nativeNotificationsEnabled) {
          const notificationPayload = {
            title,
            body,
            tag: `ready-${sessionId}`,
            kind: 'ready',
            sessionId,
            requireHidden: settings.notificationMode !== 'always',
          };

          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        await pushToUiSessions(
          {
            title,
            body,
            tag: `ready-${sessionId}`,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              sessionId,
              type: 'ready',
            },
          },
          { requireNoSse: true },
        );
      }

      if (info?.role === 'assistant' && info?.finish === 'error' && sessionId) {
        const settings = await readSettingsFromDisk();
        if (settings.notifyOnError === false) return;
        if (settings.notifyOnSubtasks === false) {
          const parentID = await fetchSessionParentId(sessionId, notificationDirectory);
          if (parentID !== null) return;
        }

        const now = Date.now();
        const lastAt = lastErrorNotificationAt.get(sessionId) ?? 0;
        if (now - lastAt < PUSH_READY_COOLDOWN_MS) return;
        lastErrorNotificationAt.set(sessionId, now);

        if (settings.notificationMode !== 'always' && getIsWindowFocused?.()) {
          return;
        }

        let title = 'Tool error';
        let body = 'An error occurred';

        try {
          const variables = await buildTemplateVariables(payload, sessionId);
          const errorMessageId = info?.id;
          let lastMessage = extractLastMessageText(payload);
          if (!lastMessage) {
            lastMessage = await fetchLastAssistantMessageText(sessionId, errorMessageId);
          }

          variables.last_message = await prepareNotificationLastMessage({
            message: lastMessage,
            settings,
          });

          const errorTemplate = (settings.notificationTemplates || {}).error || { title: 'Tool error', message: '{last_message}' };
          const resolvedTitle = resolveNotificationTemplate(errorTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(errorTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(errorTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Error template resolution failed, using defaults:', error?.message || error);
        }

        if (settings.nativeNotificationsEnabled) {
          const notificationPayload = {
            title,
            body,
            tag: `error-${sessionId}`,
            kind: 'error',
            sessionId,
            requireHidden: settings.notificationMode !== 'always',
          };
          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        await pushToUiSessions(
          {
            title,
            body,
            tag: `error-${sessionId}`,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              sessionId,
              type: 'error',
            },
          },
          { requireNoSse: true },
        );
      }

      return;
    }

    if (payload.type === 'question.asked' && sessionId) {
      const existingTimer = pushQuestionDebounceTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer);
      }

      const timer = setTimeout(async () => {
        pushQuestionDebounceTimers.delete(sessionId);

        const settings = await readSettingsFromDisk();
        if (settings.notifyOnQuestion === false) {
          return;
        }

        if (settings.notificationMode !== 'always' && getIsWindowFocused?.()) {
          return;
        }

        const firstQuestion = payload.properties?.questions?.[0];
        const header = typeof firstQuestion?.header === 'string' ? firstQuestion.header.trim() : '';
        const questionText = typeof firstQuestion?.question === 'string' ? firstQuestion.question.trim() : '';

        let title = /plan\s*mode/i.test(header)
          ? 'Switch to plan mode'
          : /build\s*agent/i.test(header)
            ? 'Switch to build mode'
            : header || 'Input needed';
        let body = questionText || 'Agent is waiting for your response';

        try {
          const variables = await buildTemplateVariables(payload, sessionId);
          variables.last_message = questionText || header || '';

          const templates = settings.notificationTemplates || {};
          const questionTemplate = templates.question || { title: 'Input needed', message: '{last_message}' };

          const resolvedTitle = resolveNotificationTemplate(questionTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(questionTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(questionTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Question template resolution failed, using defaults:', error?.message || error);
        }

        if (settings.nativeNotificationsEnabled) {
          const notificationPayload = {
            kind: 'question',
            title,
            body,
            tag: `question-${sessionId}`,
            sessionId,
            requireHidden: settings.notificationMode !== 'always',
          };
          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        void pushToUiSessions(
          {
            title,
            body,
            tag: `question-${sessionId}`,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              sessionId,
              type: 'question',
            },
          },
          { requireNoSse: true },
        );
      }, PUSH_QUESTION_DEBOUNCE_MS);

      pushQuestionDebounceTimers.set(sessionId, timer);
      return;
    }

    if (payload.type === 'permission.replied' && sessionId) {
      const requestId = payload.properties?.requestID ?? payload.properties?.requestId ?? payload.properties?.id;
      const requestKey = typeof requestId === 'string' ? `${sessionId}:${requestId}` : null;
      const pendingNotification = pushPermissionDebounceTimers.get(sessionId);
      if (!pendingNotification) {
        return;
      }

      // Some runtimes may omit requestID on permission.replied.
      // When request ID is missing, clear session debounce to avoid
      // showing stale permission notifications for auto-approved prompts.
      if (!requestKey || !pendingNotification.requestKey || pendingNotification.requestKey === requestKey) {
        clearTimeout(pendingNotification.timer);
        pushPermissionDebounceTimers.delete(sessionId);
      }
      return;
    }

    if (payload.type === 'permission.asked' && sessionId) {
      const requestId = payload.properties?.id ?? payload.properties?.requestID ?? payload.properties?.requestId;
      const permission = payload.properties?.permission;
      const requestKey = typeof requestId === 'string' ? `${sessionId}:${requestId}` : null;
      if (requestKey && notifiedPermissionRequests.has(requestKey)) {
        return;
      }

      // The session (or an ancestor) answers permissions by itself. Skip the
      // notification when this request was answered automatically; one the
      // safety net held for the user still notifies. The per-request getter
      // (the permission runtime's `isPermissionAutoAnswered`, upstream segb
      // 1bc709ed0) decides; the local ancestor walk only covers hosts that
      // never wired the getter.
      if (
        await (getIsSessionAutoAccepting?.(sessionId, notificationDirectory, requestId)
          ?? isSessionAutoAccepting(sessionId, notificationDirectory))
      ) {
        if (requestKey) notifiedPermissionRequests.add(requestKey);
        return;
      }

      const existingTimer = pushPermissionDebounceTimers.get(sessionId);
      if (existingTimer) {
        clearTimeout(existingTimer.timer);
      }

      const timer = setTimeout(async () => {
        pushPermissionDebounceTimers.delete(sessionId);

        if (
          await (getIsSessionAutoAccepting?.(sessionId, notificationDirectory, requestId)
            ?? isSessionAutoAccepting(sessionId, notificationDirectory))
        ) {
          if (requestKey) notifiedPermissionRequests.add(requestKey);
          return;
        }

        const settings = await readSettingsFromDisk();

        if (settings.notifyOnQuestion === false) {
          return;
        }

        if (settings.notificationMode !== 'always' && getIsWindowFocused?.()) {
          return;
        }

        const sessionTitle = payload.properties?.sessionTitle;
        const permissionText = typeof permission === 'string' && permission.length > 0 ? permission : '';
        const fallbackMessage = typeof sessionTitle === 'string' && sessionTitle.trim().length > 0
          ? sessionTitle.trim()
          : permissionText || 'Agent is waiting for your approval';

        let title = 'Permission required';
        let body = fallbackMessage;

        try {
          const variables = await buildTemplateVariables(payload, sessionId);
          variables.last_message = fallbackMessage;

          const templates = settings.notificationTemplates || {};
          const questionTemplate = templates.question || { title: 'Permission required', message: '{last_message}' };

          const resolvedTitle = resolveNotificationTemplate(questionTemplate.title, variables);
          const resolvedBody = resolveNotificationTemplate(questionTemplate.message, variables);
          if (resolvedTitle) title = resolvedTitle;
          if (shouldApplyResolvedTemplateMessage(questionTemplate.message, resolvedBody, variables)) body = resolvedBody;
        } catch (error) {
          console.warn('[Notification] Permission template resolution failed, using defaults:', error?.message || error);
        }

        if (settings.nativeNotificationsEnabled) {
          const notificationPayload = {
            kind: 'permission',
            title,
            body,
            tag: requestKey ? `permission-${requestKey}` : `permission-${sessionId}`,
            sessionId,
            requireHidden: settings.notificationMode !== 'always',
          };
          const desktopNotificationDelivered = emitDesktopNotification(notificationPayload);
          broadcastUiNotification(notificationPayload, { desktopNotificationDelivered });
        }

        if (requestKey) {
          notifiedPermissionRequests.add(requestKey);
        }

        void pushToUiSessions(
          {
            title,
            body,
            tag: `permission-${sessionId}`,
            data: {
              url: buildSessionDeepLinkUrl(sessionId),
              sessionId,
              type: 'permission',
            },
          },
          { requireNoSse: true },
        );
      }, PUSH_PERMISSION_DEBOUNCE_MS);

      pushPermissionDebounceTimers.set(sessionId, { timer, requestKey });
    }
  };

  return {
    maybeSendPushForTrigger,
    setAutoAcceptSession,
    setGetIsWindowFocused,
    setGetIsSessionAutoAccepting,
  };
};
