import path from 'node:path';
import { createOpencodeClient } from '@opencode-ai/sdk/v2';
import { readMessageRecords } from '../opencode/message-records.js';
import { isV2PromptTrack } from '../opencode/v2-prompt-dispatch.js';
import { OPENCHAMBER_ALL_ACTIONS } from './actions.js';
import { OpenChamberControlError, asControlError } from './error.js';
import { writeScreenshot } from './screenshots.js';

const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
const MAX_WAIT_TIMEOUT_SECONDS = 86_400;
const WAIT_POLL_INTERVAL_MS = 500;
const CONTROL_ACTIONS = new Set(OPENCHAMBER_ALL_ACTIONS);
const TASK_ACTIONS = new Set(['schedule.run', 'schedule.delete', 'schedule.toggle']);

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const positiveInteger = (value, fallback, field) => {
  if (value === undefined || value === null) return fallback;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) {
    throw new OpenChamberControlError(`${field} must be a positive integer`, 400);
  }
  return number;
};

const normalizeWaitTimeoutMs = (value) => {
  const seconds = value === undefined || value === null ? DEFAULT_WAIT_TIMEOUT_SECONDS : Number(value);
  if (!Number.isSafeInteger(seconds) || seconds < 1 || seconds > MAX_WAIT_TIMEOUT_SECONDS) {
    throw new OpenChamberControlError(`timeout must be from 1 to ${MAX_WAIT_TIMEOUT_SECONDS} seconds`, 400);
  }
  return seconds * 1000;
};

const extractTextMessages = (messages, role = 'all') => {
  const result = [];
  for (const record of Array.isArray(messages) ? messages : []) {
    const info = record?.info;
    const messageRole = info?.role;
    if ((messageRole !== 'user' && messageRole !== 'assistant') || (role !== 'all' && role !== messageRole)) {
      continue;
    }
    const text = Array.isArray(record?.parts)
      ? record.parts
        .filter((part) => part?.type === 'text' && typeof part.text === 'string')
        .map((part) => part.text)
        .join('')
        .trim()
      : '';
    if (!text) continue;
    const providerID = asNonEmptyString(info.providerID) || asNonEmptyString(info.model?.providerID);
    const modelID = asNonEmptyString(info.modelID) || asNonEmptyString(info.model?.modelID);
    result.push({
      id: asNonEmptyString(info.id) || '',
      role: messageRole,
      createdAt: Number.isFinite(info?.time?.created) ? info.time.created : null,
      completedAt: Number.isFinite(info?.time?.completed) ? info.time.completed : null,
      model: providerID && modelID ? `${providerID}/${modelID}` : null,
      text,
    });
  }
  return result.sort((left, right) => (left.createdAt || 0) - (right.createdAt || 0));
};

const parseModel = (value) => {
  const model = asNonEmptyString(value);
  if (!model) throw new OpenChamberControlError('model is required', 400);
  const slashIndex = model.indexOf('/');
  if (slashIndex <= 0 || slashIndex === model.length - 1) {
    throw new OpenChamberControlError('model must be in provider/model format', 400);
  }
  return { providerID: model.slice(0, slashIndex), modelID: model.slice(slashIndex + 1) };
};

const parseWeekdays = (value) => {
  const raw = asNonEmptyString(value);
  if (!raw) throw new OpenChamberControlError('weekly is required', 400);
  const weekdays = raw.split(',').map((entry) => Number.parseInt(entry.trim(), 10));
  if (weekdays.some((entry) => !Number.isInteger(entry) || entry < 0 || entry > 6)) {
    throw new OpenChamberControlError('weekly must contain weekdays from 0 to 6', 400);
  }
  return Array.from(new Set(weekdays)).sort((left, right) => left - right);
};

const buildSchedule = (input) => {
  const daily = asNonEmptyString(input.daily);
  const weekly = asNonEmptyString(input.weekly);
  const once = asNonEmptyString(input.once);
  const cron = asNonEmptyString(input.cron);
  if ([daily, weekly, once, cron].filter(Boolean).length !== 1) {
    throw new OpenChamberControlError('Provide exactly one of daily, weekly, once, or cron', 400);
  }
  const timezone = asNonEmptyString(input.timezone);
  if (daily) return { kind: 'daily', times: [daily], ...(timezone ? { timezone } : {}) };
  if (weekly) {
    const time = asNonEmptyString(input.time);
    if (!time) throw new OpenChamberControlError('time is required with weekly', 400);
    return { kind: 'weekly', weekdays: parseWeekdays(weekly), times: [time], ...(timezone ? { timezone } : {}) };
  }
  if (once) {
    const time = asNonEmptyString(input.time);
    if (!time) throw new OpenChamberControlError('time is required with once', 400);
    return { kind: 'once', date: once, time, ...(timezone ? { timezone } : {}) };
  }
  return { kind: 'cron', cron, ...(timezone ? { timezone } : {}) };
};

const buildScheduledTask = (input) => {
  const name = asNonEmptyString(input.name);
  const prompt = asNonEmptyString(input.prompt);
  if (!name) throw new OpenChamberControlError('name is required', 400);
  if (!prompt) throw new OpenChamberControlError('prompt is required', 400);
  const goalTokenBudget = input.goalTokenBudget;
  if (goalTokenBudget !== undefined && input.goal !== true) {
    throw new OpenChamberControlError('goalTokenBudget requires goal', 400);
  }
  if (goalTokenBudget !== undefined
    && (!Number.isSafeInteger(goalTokenBudget) || goalTokenBudget < 1000 || goalTokenBudget > 100_000_000)) {
    throw new OpenChamberControlError('goalTokenBudget must be from 1000 to 100000000', 400);
  }
  return {
    name,
    enabled: input.disabled !== true,
    schedule: buildSchedule(input),
    execution: {
      prompt,
      ...parseModel(input.model),
      ...(asNonEmptyString(input.agent) ? { agent: input.agent.trim() } : {}),
      ...(asNonEmptyString(input.variant) ? { variant: input.variant.trim() } : {}),
      ...(input.goal === true ? { goalEnabled: true } : {}),
      ...(goalTokenBudget !== undefined ? { goalTokenBudget } : {}),
    },
  };
};

export const createOpenChamberControlService = (dependencies) => {
  const {
    readSettingsFromDiskMigrated,
    sanitizeProjects,
    buildOpenCodeUrl,
    getOpenCodeAuthHeaders,
    waitForOpenCodeReady,
    sessionService,
    scheduledTaskService,
    browserControl = null,
    fileOpen = null,
    notifyUser = null,
    agentMemoryActions = null,
    createClient = createOpencodeClient,
    sleep = (duration) => new Promise((resolve) => setTimeout(resolve, duration)),
    now = Date.now,
    localServerId = 'default',
  } = dependencies;

  const assertManagedLocalAuthority = (input) => {
    const serverId = asNonEmptyString(input?.serverId);
    if (!serverId) throw new OpenChamberControlError('serverId is required', 400);
    if (serverId !== localServerId) {
      throw new OpenChamberControlError(
        `OpenChamber control actions are available only on managed local server '${localServerId}', not '${serverId}'`,
        409,
      );
    }
    return serverId;
  };

  const wait = (duration, signal) => {
    if (!signal) return sleep(duration);
    if (signal.aborted) return Promise.reject(new OpenChamberControlError('OpenChamber action was cancelled', 499));
    return new Promise((resolve, reject) => {
      const onAbort = () => {
        signal.removeEventListener('abort', onAbort);
        reject(new OpenChamberControlError('OpenChamber action was cancelled', 499));
      };
      signal.addEventListener('abort', onAbort, { once: true });
      sleep(duration).then(() => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      }, (error) => {
        signal.removeEventListener('abort', onAbort);
        reject(error);
      });
    });
  };

  const getClient = async () => {
    if (typeof waitForOpenCodeReady === 'function') await waitForOpenCodeReady(10_000, 250);
    return createClient({
      baseUrl: buildOpenCodeUrl('/', '').replace(/\/$/, ''),
      headers: getOpenCodeAuthHeaders(),
    });
  };

  const projects = async () => {
    const settings = await readSettingsFromDiskMigrated();
    return sanitizeProjects(settings?.projects || []).map((project) => ({
      id: project.id,
      path: path.resolve(project.path),
      label: asNonEmptyString(project.label) || path.basename(project.path) || project.path,
    }));
  };

  const models = async () => {
    const settings = await readSettingsFromDiskMigrated();
    return {
      defaultModel: asNonEmptyString(settings?.defaultModel),
      defaultVariant: asNonEmptyString(settings?.defaultVariant),
      defaultAgent: asNonEmptyString(settings?.defaultAgent),
      favoriteModels: Array.isArray(settings?.favoriteModels) ? settings.favoriteModels : [],
      recentModels: Array.isArray(settings?.recentModels) ? settings.recentModels : [],
    };
  };

  const sessionStatus = async (client, sessionID, directory) => {
    const response = await client.session.status({ directory });
    const statuses = response?.data;
    if (!statuses || typeof statuses !== 'object' || Array.isArray(statuses)) {
      throw new OpenChamberControlError('Invalid session status response', 500);
    }
    return statuses[sessionID] || { type: 'idle' };
  };

  // v2 branch: OpenCode 2 serves message lists only under /api and answers
  // flat records in a {data, cursor} page — plain-fetch there and normalize to
  // the v1 view; the v1 track keeps the SDK call byte-identical.
  const fetchMessageRecords = async (client, sessionID, directory, fetchLimit) => {
    if (isV2PromptTrack()) {
      const url = new URL(`${buildOpenCodeUrl('/', '').replace(/\/$/, '')}/api/session/${encodeURIComponent(sessionID)}/message`);
      if (fetchLimit !== undefined) url.searchParams.set('limit', String(fetchLimit));
      const response = await fetch(url, {
        headers: { ...getOpenCodeAuthHeaders(), 'x-opencode-directory': directory, accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`OpenCode session messages failed with ${response.status}`);
      return readMessageRecords(await response.json().catch(() => null)) ?? [];
    }
    const response = await client.session.messages({
      sessionID,
      directory,
      ...(fetchLimit ? { limit: fetchLimit } : {}),
    });
    return readMessageRecords(response) ?? [];
  };

  const sessionMessages = async (client, sessionID, directory, role, limit) => {
    const fetchLimit = limit === undefined ? undefined : Math.max(100, limit * 4);
    let raw = await fetchMessageRecords(client, sessionID, directory, fetchLimit);
    let messages = extractTextMessages(raw, role);
    if (limit !== undefined && messages.length < limit && raw.length >= fetchLimit) {
      raw = await fetchMessageRecords(client, sessionID, directory, undefined);
      messages = extractTextMessages(raw, role);
    }
    return limit === undefined ? messages : messages.slice(-limit);
  };

  const waitForIdle = async ({
    client,
    sessionID,
    directory,
    timeoutMs,
    requireActivity,
    baselineMessageID,
    startedAt,
    signal,
  }) => {
    const deadline = now() + timeoutMs;
    let observedActivity = false;
    while (true) {
      if (signal?.aborted) throw new OpenChamberControlError('OpenChamber action was cancelled', 499);
      const status = await sessionStatus(client, sessionID, directory);
      if (status.type === 'busy' || status.type === 'retry') {
        observedActivity = true;
      } else if (!requireActivity || observedActivity) {
        return status;
      } else {
        const message = (await sessionMessages(client, sessionID, directory, 'assistant', 1))[0];
        if (message?.completedAt
          && (baselineMessageID ? message.id !== baselineMessageID : message.completedAt >= startedAt)) {
          return status;
        }
      }
      const remaining = deadline - now();
      if (remaining <= 0) {
        throw new OpenChamberControlError(
          `Session did not become idle within ${Math.ceil(timeoutMs / 1000)} seconds`,
          500,
        );
      }
      await wait(Math.min(WAIT_POLL_INTERVAL_MS, remaining), signal);
    }
  };

  const executeSessionMutation = async (action, input, signal) => {
    if (input.timeout !== undefined && input.wait !== true) {
      throw new OpenChamberControlError('timeout requires wait', 400);
    }
    if (input.lastAssistant === true && input.wait !== true) {
      throw new OpenChamberControlError('lastAssistant requires wait', 400);
    }
    const directory = asNonEmptyString(input.directory);
    if (!directory && !asNonEmptyString(input.projectId)) {
      throw new OpenChamberControlError('directory or projectId is required', 400);
    }
    const payload = {
      serverId: input.serverId,
      ...(directory ? { directory } : {}),
      ...(asNonEmptyString(input.projectId) ? { projectId: input.projectId.trim() } : {}),
      ...(asNonEmptyString(input.title) ? { title: input.title.trim() } : {}),
      ...(asNonEmptyString(input.prompt) ? { prompt: input.prompt.trim() } : {}),
      ...(asNonEmptyString(input.model) ? { model: input.model.trim() } : {}),
      ...(asNonEmptyString(input.agent) ? { agent: input.agent.trim() } : {}),
      ...(asNonEmptyString(input.variant) ? { variant: input.variant.trim() } : {}),
      ...(input.goal === true ? { goal: true } : {}),
      ...(input.goalTokenBudget !== undefined ? { goalTokenBudget: input.goalTokenBudget } : {}),
      ...(asNonEmptyString(input.worktree) ? {
        worktree: {
          name: input.worktree.trim(),
          ...(asNonEmptyString(input.branch) ? { branchName: input.branch.trim() } : {}),
          ...(asNonEmptyString(input.startRef) ? { startRef: input.startRef.trim() } : {}),
        },
      } : {}),
      ...(typeof input.setUpstream === 'boolean' ? { setUpstream: input.setUpstream } : {}),
      ...(asNonEmptyString(input.messageId) ? { messageId: input.messageId.trim() } : {}),
    };
    const sourceSessionID = asNonEmptyString(input.sessionId);
    const startedAt = now();
    let result;
    if (action === 'session.create') {
      result = await sessionService.create(payload);
    } else {
      if (!sourceSessionID) throw new OpenChamberControlError('sessionId is required', 400);
      result = action === 'session.send'
        ? await sessionService.send(sourceSessionID, payload)
        : await sessionService.fork(sourceSessionID, payload);
    }
    if (input.wait !== true) {
      const publicResult = { ...result };
      delete publicResult.baselineAssistantMessageId;
      return publicResult;
    }
    const client = await getClient();
    const status = await waitForIdle({
      client,
      sessionID: result.sessionId,
      directory: result.directory,
      timeoutMs: normalizeWaitTimeoutMs(input.timeout),
      requireActivity: result.promptDispatched === true,
      baselineMessageID: result.baselineAssistantMessageId,
      startedAt,
      signal,
    });
    const publicResult = { ...result, sessionStatus: status };
    delete publicResult.baselineAssistantMessageId;
    if (input.lastAssistant === true) {
      publicResult.lastAssistantMessage = (
        await sessionMessages(client, result.sessionId, result.directory, 'assistant', 1)
      )[0] || null;
    }
    return publicResult;
  };

  const executeScheduleAction = async (action, input) => {
    const taskID = asNonEmptyString(input.taskId);
    if (TASK_ACTIONS.has(action) && !taskID) {
      throw new OpenChamberControlError('taskId is required', 400);
    }
    const projectID = await scheduledTaskService.resolveProjectID({
      projectId: asNonEmptyString(input.projectId) || undefined,
      directory: asNonEmptyString(input.directory) || undefined,
    });
    if (action === 'schedule.list') {
      return { scheduler: await scheduledTaskService.status(), tasks: await scheduledTaskService.list(projectID) };
    }
    if (action === 'schedule.create') {
      const result = await scheduledTaskService.upsert(projectID, buildScheduledTask(input));
      return { task: result.task, created: result.created };
    }
    if (action === 'schedule.run') return scheduledTaskService.run(projectID, taskID);
    if (action === 'schedule.delete') {
      return { deleted: true, tasks: await scheduledTaskService.remove(projectID, taskID) };
    }
    if (typeof input.disabled !== 'boolean') {
      throw new OpenChamberControlError('disabled is required for schedule.toggle', 400);
    }
    const enabled = input.disabled === false;
    return { task: await scheduledTaskService.setEnabled(projectID, taskID, enabled), enabled };
  };

  const executeBrowserAction = async (action, input, contextDirectory, signal, contextSessionId) => {
    if (!browserControl) throw new OpenChamberControlError('The in-app browser is not available on this server', 503);
    const parameters = {};
    const viewport = asNonEmptyString(input.viewport);
    if (viewport) {
      if (!['mobile', 'tablet', 'desktop', 'fill'].includes(viewport)) {
        throw new OpenChamberControlError('viewport must be mobile, tablet, desktop, or fill', 400);
      }
      parameters.viewport = viewport;
    } else if (action === 'browser.resize') {
      throw new OpenChamberControlError('viewport is required for browser.resize', 400);
    }
    if (action === 'browser.open') {
      const url = asNonEmptyString(input.url);
      if (!url) throw new OpenChamberControlError('url is required for browser.open', 400);
      let parsed;
      try { parsed = new URL(url); } catch { throw new OpenChamberControlError('url must be an absolute http(s) URL', 400); }
      if (!['http:', 'https:'].includes(parsed.protocol)) throw new OpenChamberControlError('url must use http or https', 400);
      parameters.url = parsed.toString();
    }
    if (action === 'browser.click') {
      const selector = asNonEmptyString(input.selector);
      const text = asNonEmptyString(input.text);
      if (!selector && !text) throw new OpenChamberControlError('browser.click requires selector or text', 400);
      if (selector) parameters.selector = selector;
      if (text) parameters.text = text;
    }
    if (action === 'browser.snapshot') {
      const selector = asNonEmptyString(input.selector);
      if (selector) parameters.selector = selector;
    }
    if (action === 'browser.inspect') {
      const selector = asNonEmptyString(input.selector);
      if (!selector) throw new OpenChamberControlError('selector is required for browser.inspect', 400);
      parameters.selector = selector;
    }
    if (action === 'browser.type') {
      const selector = asNonEmptyString(input.selector);
      if (!selector) throw new OpenChamberControlError('selector is required for browser.type', 400);
      if (typeof input.value !== 'string') throw new OpenChamberControlError('value is required for browser.type', 400);
      Object.assign(parameters, { selector, value: input.value, submit: input.submit === true });
    }
    if (action === 'browser.scroll') {
      const selector = asNonEmptyString(input.selector);
      const direction = asNonEmptyString(input.direction);
      if (!selector && !direction) throw new OpenChamberControlError('browser.scroll requires direction or selector', 400);
      if (direction && !['up', 'down', 'top', 'bottom'].includes(direction)) {
        throw new OpenChamberControlError('direction must be up, down, top, or bottom', 400);
      }
      if (selector) parameters.selector = selector;
      if (direction) parameters.direction = direction;
    }
    if (action === 'browser.capture' && asNonEmptyString(input.label)) parameters.label = input.label.trim();

    // Where the call came from, for a provider that keeps one browser per
    // project or chat. Filled by the tool plugin, never by the model.
    const context = {
      directory: asNonEmptyString(contextDirectory),
      sessionId: asNonEmptyString(contextSessionId),
    };
    const result = await browserControl.request(action, parameters, {
      signal,
      timeoutMs: action === 'browser.open' ? 45_000 : 20_000,
      context,
    });
    if (action !== 'browser.capture') return result;
    const directory = asNonEmptyString(input.directory) || asNonEmptyString(contextDirectory);
    if (!directory) throw new OpenChamberControlError('directory is required to save a screenshot', 400);
    const capture = result && typeof result === 'object' ? result : {};
    const saved = await writeScreenshot({ directory, base64: capture.base64, mime: capture.mime, label: input.label });
    return {
      path: saved.path,
      hint: `Write ![](${saved.path}) in your reply to show this image to the user.`,
      url: capture.url ?? null,
      title: capture.title ?? null,
      viewport: capture.viewport ?? null,
      width: capture.width ?? null,
      height: capture.height ?? null,
    };
  };

  // projectId and directory are two names for one scope. Accepting both let
  // one silently win over the other, so every session action refuses the pair.
  const assertSingleScope = (input) => {
    if (asNonEmptyString(input.projectId) && asNonEmptyString(input.directory)) {
      throw new OpenChamberControlError('Provide only one of projectId or directory', 400);
    }
  };

  // An explicit projectId scopes a session read to that project's directory,
  // resolved the same way create/send/fork resolve it. An unknown project is
  // an error, never a silent read of the caller's directory or of every project.
  const resolveReadDirectory = async (input) => {
    assertSingleScope(input);
    const projectID = asNonEmptyString(input.projectId);
    if (!projectID) return asNonEmptyString(input.directory);
    return (await sessionService.resolveDirectory({ projectId: projectID })).directory;
  };

  const execute = async (action, input = {}, contextDirectory, options = {}) => {
    try {
      if (!CONTROL_ACTIONS.has(action)) {
        throw new OpenChamberControlError(`Unsupported OpenChamber action: ${action || 'missing'}`, 400);
      }
      assertManagedLocalAuthority(input);
      if (action.startsWith('memory.')) {
        if (!agentMemoryActions) {
          throw new OpenChamberControlError('Agent memory is not available on this server', 503);
        }
        return agentMemoryActions.execute(action, input, contextDirectory || input.directory);
      }
      if (action.startsWith('browser.')) return executeBrowserAction(action, input, contextDirectory, options.signal, options.contextSessionId);
      if (action === 'notify.send') {
        if (!notifyUser) {
          throw new OpenChamberControlError('Notifications are not available on this server', 503);
        }
        const result = await notifyUser({
          title: input.title,
          body: input.body,
          showWhenFocused: input.showWhenFocused,
          sessionId: asNonEmptyString(options.contextSessionId) || undefined,
          directory: asNonEmptyString(contextDirectory) || undefined,
        });
        if (result.status !== 200) {
          throw new OpenChamberControlError(result.body.error, result.status);
        }
        return result.body;
      }
      if (action === 'file.open') {
        if (!fileOpen) {
          throw new OpenChamberControlError('The file viewer is not available on this server', 503);
        }
        return fileOpen.request({
          path: asNonEmptyString(input.path),
          directory: asNonEmptyString(input.directory) || asNonEmptyString(contextDirectory),
          sessionId: asNonEmptyString(options.contextSessionId),
        });
      }
      if (action === 'projects.list') return { projects: await projects() };
      if (action === 'models.list') return models();
      if (action === 'schedule.status') return scheduledTaskService.status();
      if (action.startsWith('schedule.')) return executeScheduleAction(action, input);
      if (action === 'session.create' || action === 'session.send' || action === 'session.fork') {
        assertSingleScope(input);
        return executeSessionMutation(action, input, options.signal);
      }

      if (action.startsWith('session.')) {
        const sessionID = asNonEmptyString(input.sessionId);
        if (action !== 'session.list' && !sessionID) throw new OpenChamberControlError('sessionId is required', 400);
      }
      const directory = await resolveReadDirectory(input);
      if (!directory) throw new OpenChamberControlError('directory is required', 400);
      const client = await getClient();
      if (action === 'session.list') {
        const limit = positiveInteger(input.limit, 10, 'limit');
        const response = await client.session.list({ directory });
        let sessions = Array.isArray(response?.data) ? response.data : [];
        if (input.all !== true) sessions = sessions.filter((session) => !session?.time?.archived);
        sessions = sessions.slice(0, limit);
        if (input.withStatus === true) {
          const statusResponse = await client.session.status({ directory }).catch(() => null);
          sessions = sessions.map((session) => ({
            ...session,
            status: statusResponse?.data?.[session.id]
              || (statusResponse ? { type: 'idle' } : { type: 'unknown' }),
          }));
        }
        return { sessions, limit, directory, serverId: input.serverId };
      }

      const sessionID = asNonEmptyString(input.sessionId);
      if (!sessionID) throw new OpenChamberControlError('sessionId is required', 400);
      if (action === 'session.status') {
        return {
          sessionId: sessionID,
          directory,
          serverId: input.serverId,
          sessionStatus: await sessionStatus(client, sessionID, directory),
        };
      }
      if (input.timeout !== undefined && input.wait !== true) {
        throw new OpenChamberControlError('timeout requires wait', 400);
      }
      const role = input.lastAssistant === true ? 'assistant' : (asNonEmptyString(input.role) || 'all');
      if (!['all', 'user', 'assistant'].includes(role)) {
        throw new OpenChamberControlError('role must be all, user, or assistant', 400);
      }
      const last = input.last === true || input.lastAssistant === true;
      if (input.all === true && (last || input.limit !== undefined)) {
        throw new OpenChamberControlError('all cannot be combined with last or limit', 400);
      }
      if (last && input.limit !== undefined) {
        throw new OpenChamberControlError('last cannot be combined with limit', 400);
      }
      const currentStatus = input.wait === true
        ? await waitForIdle({
          client,
          sessionID,
          directory,
          timeoutMs: normalizeWaitTimeoutMs(input.timeout),
          requireActivity: false,
          startedAt: now(),
          signal: options.signal,
        })
        : await sessionStatus(client, sessionID, directory);
      const limit = input.all === true ? undefined : (last ? 1 : positiveInteger(input.limit, 10, 'limit'));
      return {
        sessionId: sessionID,
        directory,
        serverId: input.serverId,
        role,
        sessionStatus: currentStatus,
        messages: await sessionMessages(client, sessionID, directory, role, limit),
      };
    } catch (error) {
      throw asControlError(error, `Failed to execute ${action || 'OpenChamber action'}`);
    }
  };

  return { execute };
};
