import {
  intro,
  outro,
  isJsonMode,
  isQuietMode,
  logStatus,
  printJson,
} from './cli-output.js';

const DEFAULT_SERVER_ID = 'default';
const DEFAULT_WAIT_TIMEOUT_SECONDS = 600;
const WAIT_HTTP_TIMEOUT_BUFFER_MS = 30_000;
const WORKTREE_PROVISION_TIMEOUT_MS = 120_000;

class ControlCliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.name = 'ControlCliError';
    this.exitCode = exitCode;
  }
}

const asNonEmptyString = (value) => {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const requireString = (value, flag) => {
  const normalized = asNonEmptyString(value);
  if (!normalized) throw new ControlCliError(`Missing required ${flag}.`, 2);
  return normalized;
};

const positiveInteger = (value, fallback, flag) => {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ControlCliError(`${flag} must be a positive integer.`, 2);
  }
  return parsed;
};

const validateModel = (value) => {
  const model = asNonEmptyString(value);
  if (!model) return undefined;
  const slash = model.indexOf('/');
  if (slash <= 0 || slash === model.length - 1) {
    throw new ControlCliError('--model must use provider/model format.', 2);
  }
  return model;
};

const requireSessionTarget = (options) => ({
  sessionId: requireString(options.sessionId, '--session'),
  directory: requireString(options.directory, '--dir'),
});

const addScope = (options) => ({
  serverId: asNonEmptyString(options.serverId) || DEFAULT_SERVER_ID,
  ...(asNonEmptyString(options.projectId) ? { projectId: options.projectId.trim() } : {}),
  ...(asNonEmptyString(options.directory) ? { directory: options.directory.trim() } : {}),
});

const validateWait = (options) => {
  if (options.timeout !== undefined && options.wait !== true) {
    throw new ControlCliError('--timeout requires --wait.', 2);
  }
  if (options.lastAssistant === true && options.wait !== true) {
    throw new ControlCliError('--last-assistant requires --wait.', 2);
  }
};

const formatSessionLine = (session) => {
  const status = session?.status?.type ? ` status:${session.status.type}` : '';
  return `${session.id}${status} ${session.title || '(untitled)'} ${session.directory || ''}`.trim();
};

const formatMessage = (message) => {
  const stamp = Number.isFinite(message.createdAt)
    ? new Date(message.createdAt).toISOString()
    : 'unknown-time';
  return `[${message.role} ${stamp}]\n${message.text}`;
};

const formatSchedule = (schedule) => {
  if (schedule?.kind === 'daily') return `daily ${(schedule.times || []).join(',')}`;
  if (schedule?.kind === 'weekly') {
    return `weekly ${(schedule.weekdays || []).join(',')} ${(schedule.times || []).join(',')}`;
  }
  if (schedule?.kind === 'once') return `once ${schedule.date || ''} ${schedule.time || ''}`.trim();
  if (schedule?.kind === 'cron') return `cron ${schedule.cron || ''}`.trim();
  return schedule?.kind || 'unknown';
};

export const createControlCommands = ({ resolveTargetInstance, requestJson }) => {
  const requestAction = async (options, action, input) => {
    const target = await resolveTargetInstance({
      options,
      allowAutoStart: false,
    });
    const provisionsWorktree = asNonEmptyString(input?.worktree) !== null;
    const waitSeconds = input.wait === true
      ? positiveInteger(input.timeout, DEFAULT_WAIT_TIMEOUT_SECONDS, '--timeout')
      : 0;
    let timeoutMs;
    if (waitSeconds > 0) {
      timeoutMs = (waitSeconds * 1000) + WAIT_HTTP_TIMEOUT_BUFFER_MS;
      if (provisionsWorktree) timeoutMs += WORKTREE_PROVISION_TIMEOUT_MS;
    } else if (provisionsWorktree) {
      timeoutMs = WORKTREE_PROVISION_TIMEOUT_MS;
    }
    const { response, body } = await requestJson(target.port, '/api/openchamber/control', {
      method: 'POST',
      body: JSON.stringify({ action, input }),
      ...(timeoutMs ? { timeoutMs } : {}),
    });
    if (response?.ok) return body;
    const partial = body?.partial === true && body?.sessionId
      ? ` Session ${body.sessionId} remains available${body.directory ? ` in ${body.directory}` : ''}.`
      : '';
    throw new ControlCliError(`${body?.error || `Failed to execute ${action}`}${partial}`, 1);
  };

  const projects = async (options, action = 'list') => {
    if (action !== 'list') throw new ControlCliError(`Unknown projects command '${action}'.`, 2);
    const result = await requestAction(options, 'projects.list', addScope(options));
    if (isJsonMode(options)) return printJson(result);
    const entries = Array.isArray(result.projects) ? result.projects : [];
    process.stdout.write(entries.length
      ? `${entries.map((project) => `${project.id}\t${project.label}\t${project.path}`).join('\n')}\n`
      : 'No projects found.\n');
  };

  const models = async (options, action = 'show') => {
    if (action !== 'show') throw new ControlCliError(`Unknown models command '${action}'.`, 2);
    const result = await requestAction(options, 'models.list', addScope(options));
    if (isJsonMode(options)) return printJson(result);
    const favorites = Array.isArray(result.favoriteModels) ? result.favoriteModels : [];
    const recent = Array.isArray(result.recentModels) ? result.recentModels : [];
    process.stdout.write([
      `Default: ${result.defaultModel || 'none'} / ${result.defaultAgent || 'none'}${result.defaultVariant ? ` (${result.defaultVariant})` : ''}`,
      `Favorites: ${favorites.map((entry) => `${entry.providerID}/${entry.modelID}`).join(', ') || 'none'}`,
      `Recent: ${recent.map((entry) => `${entry.providerID}/${entry.modelID}`).join(', ') || 'none'}`,
      '',
    ].join('\n'));
  };

  const session = async (options, action = 'help') => {
    if (action === 'help') {
      process.stdout.write(
        'Usage: openchamber session <list|create|send|fork|status|messages> '
        + '--server default --dir <path> [options]\n',
      );
      return;
    }
    const scope = addScope(options);
    if (action === 'list') {
      requireString(scope.directory, '--dir');
      const result = await requestAction(options, 'session.list', {
        ...scope,
        limit: positiveInteger(options.limit, 10, '--limit'),
        all: options.all === true,
        withStatus: options.withStatus === true,
      });
      if (isJsonMode(options)) return printJson(result);
      const sessions = Array.isArray(result.sessions) ? result.sessions : [];
      process.stdout.write(sessions.length
        ? `${sessions.map(formatSessionLine).join('\n')}\n`
        : 'No sessions found.\n');
      return;
    }
    if (action === 'status') {
      const target = requireSessionTarget(options);
      const result = await requestAction(options, 'session.status', { ...scope, ...target });
      if (isJsonMode(options)) return printJson(result);
      process.stdout.write(`${result.sessionStatus?.type || 'unknown'}\n`);
      return;
    }
    if (action === 'messages') {
      const target = requireSessionTarget(options);
      if (options.timeout !== undefined && options.wait !== true) {
        throw new ControlCliError('--timeout requires --wait.', 2);
      }
      if (options.all && (options.last || options.lastAssistant || options.limit !== undefined)) {
        throw new ControlCliError('--all cannot be combined with --last, --last-assistant, or --limit.', 2);
      }
      const result = await requestAction(options, 'session.messages', {
        ...scope,
        ...target,
        role: options.lastAssistant ? 'assistant' : (options.role || 'all'),
        all: options.all === true,
        last: options.last === true,
        lastAssistant: options.lastAssistant === true,
        wait: options.wait === true,
        ...(options.limit !== undefined ? { limit: positiveInteger(options.limit, 10, '--limit') } : {}),
        ...(options.timeout !== undefined ? { timeout: positiveInteger(options.timeout, undefined, '--timeout') } : {}),
      });
      if (isJsonMode(options)) return printJson(result);
      const messages = Array.isArray(result.messages) ? result.messages : [];
      if (isQuietMode(options)) {
        process.stdout.write(messages.length ? `${messages.map((message) => message.text).join('\n\n')}\n` : '');
        return;
      }
      process.stdout.write(messages.length ? `${messages.map(formatMessage).join('\n\n---\n\n')}\n` : 'No text messages found.\n');
      return;
    }

    validateWait(options);
    if (action === 'send' || action === 'fork') {
      const target = requireSessionTarget(options);
      const model = validateModel(options.model);
      const result = await requestAction(options, `session.${action}`, {
        ...scope,
        ...target,
        prompt: requireString(options.prompt, '--prompt'),
        ...(action === 'fork' && asNonEmptyString(options.messageId)
          ? { messageId: options.messageId.trim() }
          : {}),
        ...(model ? { model } : {}),
        ...(asNonEmptyString(options.agent) ? { agent: options.agent.trim() } : {}),
        ...(asNonEmptyString(options.variant) ? { variant: options.variant.trim() } : {}),
        ...(options.goal ? { goal: true } : {}),
        ...(options.goalTokenBudget !== undefined
          ? { goalTokenBudget: positiveInteger(options.goalTokenBudget, undefined, '--goal-token-budget') }
          : {}),
        wait: options.wait === true,
        lastAssistant: options.lastAssistant === true,
        ...(options.timeout !== undefined ? { timeout: positiveInteger(options.timeout, undefined, '--timeout') } : {}),
      });
      if (isJsonMode(options)) return printJson(result);
      if (isQuietMode(options)) {
        process.stdout.write(`${result.sessionId || ''}\n`);
        if (result.lastAssistantMessage?.text) process.stdout.write(`${result.lastAssistantMessage.text}\n`);
        return;
      }
      intro(action === 'fork' ? 'Session Forked' : 'Session Prompt Sent');
      logStatus('success', result.sessionId, `directory: ${result.directory}`);
      outro(action === 'fork' ? 'forked' : 'sent');
      return;
    }
    if (action !== 'create') throw new ControlCliError(`Unknown session command '${action}'.`, 2);
    if (!scope.directory && !scope.projectId) {
      throw new ControlCliError('Session create requires --dir or --project.', 2);
    }
    const model = validateModel(options.model);
    const result = await requestAction(options, 'session.create', {
      ...scope,
      ...(asNonEmptyString(options.name) ? { title: options.name.trim() } : {}),
      ...(asNonEmptyString(options.prompt) ? { prompt: options.prompt.trim() } : {}),
      ...(model ? { model } : {}),
      ...(asNonEmptyString(options.agent) ? { agent: options.agent.trim() } : {}),
      ...(asNonEmptyString(options.variant) ? { variant: options.variant.trim() } : {}),
      ...(asNonEmptyString(options.worktree) ? { worktree: options.worktree.trim() } : {}),
      ...(asNonEmptyString(options.branch) ? { branch: options.branch.trim() } : {}),
      ...(asNonEmptyString(options.startRef) ? { startRef: options.startRef.trim() } : {}),
      ...(typeof options.setUpstream === 'boolean' ? { setUpstream: options.setUpstream } : {}),
      ...(options.goal ? { goal: true } : {}),
      ...(options.goalTokenBudget !== undefined
        ? { goalTokenBudget: positiveInteger(options.goalTokenBudget, undefined, '--goal-token-budget') }
        : {}),
      wait: options.wait === true,
      lastAssistant: options.lastAssistant === true,
      ...(options.timeout !== undefined ? { timeout: positiveInteger(options.timeout, undefined, '--timeout') } : {}),
    });
    if (isJsonMode(options)) return printJson(result);
    if (isQuietMode(options)) return process.stdout.write(`${result.sessionId || ''}\n`);
    intro('Session Created');
    logStatus('success', result.sessionId, `directory: ${result.directory}`);
    outro('created');
  };

  const schedule = async (options, action = 'help') => {
    if (action === 'help') {
      process.stdout.write(
        'Usage: openchamber schedule <status|list|create|run|delete|enable|disable> '
        + '--server default (--project <id> | --dir <path>) [options]\n',
      );
      return;
    }
    const scope = addScope(options);
    if (action === 'status') {
      const result = await requestAction(options, 'schedule.status', scope);
      return isJsonMode(options) ? printJson(result) : process.stdout.write(`${JSON.stringify(result)}\n`);
    }
    if (!scope.projectId && !scope.directory) {
      throw new ControlCliError(`Schedule ${action} requires --project or --dir.`, 2);
    }
    if (action === 'list') {
      const result = await requestAction(options, 'schedule.list', scope);
      if (isJsonMode(options)) return printJson(result);
      const tasks = Array.isArray(result.tasks) ? result.tasks : [];
      process.stdout.write(tasks.length
        ? `${tasks.map((task) => `${task.id}\t${task.enabled === false ? 'disabled' : 'enabled'}\t${formatSchedule(task.schedule)}\t${task.name}`).join('\n')}\n`
        : 'No scheduled tasks found.\n');
      return;
    }
    if (action === 'create') {
      const scheduleSelectors = [options.daily, options.weekly, options.once, options.cron]
        .filter((value) => asNonEmptyString(value));
      if (scheduleSelectors.length !== 1) {
        throw new ControlCliError('Provide exactly one of --daily, --weekly, --once, or --cron.', 2);
      }
      const result = await requestAction(options, 'schedule.create', {
        ...scope,
        name: requireString(options.name, '--name'),
        prompt: requireString(options.prompt, '--prompt'),
        model: requireString(validateModel(options.model), '--model'),
        ...(asNonEmptyString(options.agent) ? { agent: options.agent.trim() } : {}),
        ...(asNonEmptyString(options.variant) ? { variant: options.variant.trim() } : {}),
        ...(asNonEmptyString(options.daily) ? { daily: options.daily.trim() } : {}),
        ...(asNonEmptyString(options.weekly) ? { weekly: options.weekly.trim() } : {}),
        ...(asNonEmptyString(options.once) ? { once: options.once.trim() } : {}),
        ...(asNonEmptyString(options.cron) ? { cron: options.cron.trim() } : {}),
        ...(asNonEmptyString(options.time) ? { time: options.time.trim() } : {}),
        ...(asNonEmptyString(options.timezone) ? { timezone: options.timezone.trim() } : {}),
        ...(options.goal ? { goal: true } : {}),
        ...(options.goalTokenBudget !== undefined
          ? { goalTokenBudget: positiveInteger(options.goalTokenBudget, undefined, '--goal-token-budget') }
          : {}),
      });
      if (isJsonMode(options)) return printJson(result);
      process.stdout.write(`${result.task?.id || ''}\n`);
      return;
    }
    if (!['run', 'delete', 'enable', 'disable'].includes(action)) {
      throw new ControlCliError(`Unknown schedule command '${action}'.`, 2);
    }
    const taskId = requireString(options.taskId, '--task');
    const controlAction = action === 'enable' || action === 'disable' ? 'toggle' : action;
    const result = await requestAction(options, `schedule.${controlAction}`, {
      ...scope,
      taskId,
      ...(action === 'enable' ? { disabled: false } : {}),
      ...(action === 'disable' ? { disabled: true } : {}),
    });
    if (isJsonMode(options)) return printJson(result);
    process.stdout.write(`${action} ${taskId}\n`);
  };

  return { projects, models, session, schedule };
};
