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

export const OPENCHAMBER_CONTROL_ACTIONS = Object.freeze(
  OPENCHAMBER_CONTROL_ACTION_DEFINITIONS.map(({ action }) => action),
);

export const OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS = Object.freeze(
  OPENCHAMBER_CONTROL_ACTION_DEFINITIONS.filter(({ agentExposed }) => agentExposed !== false),
);

export const OPENCHAMBER_AGENT_TOOL_ACTIONS = Object.freeze(
  OPENCHAMBER_AGENT_TOOL_ACTION_DEFINITIONS.map(({ action }) => action),
);
