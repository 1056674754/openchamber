export const OPENCHAMBER_CONTROL_ACTION_DEFINITIONS = Object.freeze([
  { action: 'projects.list', title: 'List configured projects', description: 'List configured projects; no parameters' },
  { action: 'models.list', title: 'Show model preferences', description: 'Show default, favorite, and recent model preferences; no parameters' },
  { action: 'session.list', title: 'List sessions', description: 'List sessions in an explicit directory; optional limit, all, or withStatus' },
  { action: 'session.create', title: 'Create a session', description: 'Create a session in an explicit directory; prompt is optional' },
  { action: 'session.send', title: 'Send a prompt', description: 'Send a new prompt to sessionId in its explicit directory' },
  { action: 'session.fork', title: 'Fork a session', description: 'Fork sessionId in its explicit directory; messageId selects the boundary' },
  { action: 'session.status', title: 'Check session status', description: 'Check sessionId status in its explicit directory' },
  { action: 'session.messages', title: 'Read session messages', description: 'Read ordered text messages and current status for sessionId' },
  { action: 'schedule.status', title: 'Check scheduler status', description: 'Check scheduler status; no parameters', agentExposed: false },
  { action: 'schedule.list', title: 'List scheduled tasks', description: 'List tasks and scheduler status; scope with projectId or directory' },
  { action: 'schedule.create', title: 'Create a scheduled task', description: 'Create task; requires name, prompt, model, and one schedule selector' },
  { action: 'schedule.run', title: 'Run a scheduled task', description: 'Run taskId; scope with projectId or directory' },
  { action: 'schedule.delete', title: 'Delete a scheduled task', description: 'Delete taskId; scope with projectId or directory' },
  { action: 'schedule.toggle', title: 'Enable or disable a scheduled task', description: 'Enable or disable taskId; requires disabled' },
]);

const OPENCHAMBER_CONTROL_ACTIONS = Object.freeze(
  OPENCHAMBER_CONTROL_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS = Object.freeze(
  OPENCHAMBER_CONTROL_ACTION_DEFINITIONS.filter(({ agentExposed }) => agentExposed !== false),
);

export const OPENCHAMBER_AGENT_TOOL_ACTIONS = Object.freeze(
  OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const OPENCHAMBER_WEB_ACTION_DEFINITIONS = Object.freeze([
  { action: 'browser.open', title: 'Open a page in the browser panel', description: 'Open absolute http(s) url; optional viewport' },
  { action: 'browser.snapshot', title: 'Read the open page', description: 'Read URL, title, visible text, interactive selectors, and page errors; optional selector' },
  { action: 'browser.click', title: 'Click on the open page', description: 'Click selector or visible text' },
  { action: 'browser.type', title: 'Type into the open page', description: 'Type value into selector; optional submit' },
  { action: 'browser.scroll', title: 'Scroll the open page', description: 'Scroll direction or selector into view' },
  { action: 'browser.back', title: 'Go back in the browser panel', description: 'Navigate back; no parameters' },
  { action: 'browser.forward', title: 'Go forward in the browser panel', description: 'Navigate forward; no parameters' },
  { action: 'browser.inspect', title: 'Read how an element renders', description: 'Read computed styles for selector' },
  { action: 'browser.capture', title: 'Save a screenshot of the page', description: 'Capture the visible page into the project; optional label' },
  { action: 'browser.resize', title: 'Change the page viewport', description: 'Set viewport to mobile, tablet, desktop, or fill' },
]);

export const OPENCHAMBER_WEB_ACTIONS = Object.freeze(
  OPENCHAMBER_WEB_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const OPENCHAMBER_MEMORY_ACTION_DEFINITIONS = Object.freeze([
  { action: 'memory.read', title: 'Read a stored memory', description: 'Read one full memory by title or memoryId; scope is optional' },
  { action: 'memory.list', title: 'List stored memories', description: 'List memory titles in global, project, or both scopes' },
  { action: 'memory.save', title: 'Remember something', description: 'Store a durable fact, preference, or reference in global or project scope' },
  { action: 'memory.delete', title: 'Forget a memory', description: 'Delete a memory by memoryId and scope' },
]);

export const OPENCHAMBER_MEMORY_ACTIONS = Object.freeze(
  OPENCHAMBER_MEMORY_ACTION_DEFINITIONS.map(({ action }) => action),
);

const ACTIONS_BY_TOOL = Object.freeze({
  openchamber: OPENCHAMBER_AGENT_TOOL_ACTIONS,
  openchamber_web: OPENCHAMBER_WEB_ACTIONS,
  openchamber_memory: OPENCHAMBER_MEMORY_ACTIONS,
});

const bareActionName = (action) => {
  const separator = action.indexOf('.');
  return separator === -1 ? action : action.slice(separator + 1);
};

const uniqueBareMatch = (candidates, requested) => {
  const matches = candidates.filter((candidate) => bareActionName(candidate) === requested);
  return matches.length === 1 ? matches[0] : null;
};

export const resolveAgentToolAction = (requested, toolName) => {
  const value = typeof requested === 'string' ? requested.trim() : '';
  const scoped = ACTIONS_BY_TOOL[toolName] ?? null;
  const known = scoped ?? OPENCHAMBER_ALL_ACTIONS;
  if (value && known.includes(value)) return { action: value };
  if (value) {
    const resolved = uniqueBareMatch(known, value)
      ?? (scoped ? null : uniqueBareMatch(OPENCHAMBER_ALL_ACTIONS, value));
    if (resolved) return { action: resolved };
  }
  return {
    error: `Unsupported OpenChamber action: ${value || 'missing'}. Use one of: ${known.join(', ')}`,
  };
};

export const OPENCHAMBER_ALL_ACTIONS = Object.freeze([
  ...OPENCHAMBER_CONTROL_ACTIONS,
  ...OPENCHAMBER_WEB_ACTIONS,
  ...OPENCHAMBER_MEMORY_ACTIONS,
]);
