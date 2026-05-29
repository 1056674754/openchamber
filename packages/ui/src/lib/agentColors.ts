

const AGENT_COLOR_PALETTE = [
  { var: '--status-success', class: 'agent-success' },
  { var: '--syntax-keyword', class: 'agent-keyword' },
  { var: '--syntax-type', class: 'agent-type' },
  { var: '--syntax-function', class: 'agent-function' },
  { var: '--syntax-number', class: 'agent-number' },
  { var: '--status-info', class: 'agent-info' },
  { var: '--status-warning', class: 'agent-warning' },
  { var: '--syntax-variable', class: 'agent-variable' },
];

export type AgentColorSource = string | {
  name?: string;
  color?: string | null;
} | undefined;

type AgentColorResult = {
  var: string;
  class: string;
  value: string;
  cssVars?: Record<'--agent-color' | '--agent-color-bg', string>;
};

const HEX_COLOR_PATTERN = /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

const getApiAgentColor = (source: AgentColorSource): string | undefined => {
  if (!source || typeof source === 'string') {
    return undefined;
  }

  const color = typeof source.color === 'string' ? source.color.trim() : '';
  return HEX_COLOR_PATTERN.test(color) ? color : undefined;
};

const getAgentName = (source: AgentColorSource): string | undefined => {
  if (typeof source === 'string') {
    return source;
  }
  return typeof source?.name === 'string' ? source.name : undefined;
};

export function getAgentColor(source: AgentColorSource): AgentColorResult {
  const agentName = getAgentName(source);

  if (!agentName) {
    const fallback = AGENT_COLOR_PALETTE[0];
    return { ...fallback, value: `var(${fallback.var})` };
  }

  if (agentName === 'build') {
    const apiColor = getApiAgentColor(source);
    const fallback = AGENT_COLOR_PALETTE[0];
    return apiColor
      ? {
          ...fallback,
          value: apiColor,
          cssVars: { '--agent-color': apiColor, '--agent-color-bg': apiColor },
        }
      : { ...fallback, value: `var(${fallback.var})` };
  }

  let hash = 0;
  for (let i = 0; i < agentName.length; i++) {
    const char = agentName.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }

  const paletteIndex = 1 + (Math.abs(hash) % (AGENT_COLOR_PALETTE.length - 1));
  const fallback = AGENT_COLOR_PALETTE[paletteIndex];
  const apiColor = getApiAgentColor(source);
  return apiColor
    ? {
        ...fallback,
        value: apiColor,
        cssVars: { '--agent-color': apiColor, '--agent-color-bg': apiColor },
      }
    : { ...fallback, value: `var(${fallback.var})` };
}

export function getAgentColorPalette() {
  return AGENT_COLOR_PALETTE;
}
