import type { IconName } from '@/components/icon/icons';
import type { I18nKey } from '@/lib/i18n';
import {
  isPluginContextPanelMode,
  type ContextPanelMode,
} from '@/lib/surfaces/modes';

export type BuiltInContextSurfaceId =
  | 'context'
  | 'git'
  | 'pr'
  | 'diff'
  | 'walkthrough'
  | 'editor'
  | 'terminal'
  | 'notes'
  | 'plan'
  | 'browser'
  | 'preview'
  | 'chat'
  | 'linear';

export type ContextSurfaceId = BuiltInContextSurfaceId | `plugin:${string}`;

export type ContextSurfaceDescriptor = {
  id: ContextSurfaceId;
  mode: ContextPanelMode;
  icon: IconName;
  /** Authenticated package SVG for a guest rail mark. Prefer over `icon` when set. */
  iconSrc?: string;
  /** Guest-provided name. When set, the rail prefers this over `labelKey`. */
  label?: string;
  labelKey: I18nKey;
  descriptionKey: I18nKey;
  availability: 'always' | 'has-content';
  defaultWidthFraction: number;
};

export const CONTEXT_SURFACES: readonly ContextSurfaceDescriptor[] = [
  {
    id: 'context',
    mode: 'context',
    icon: 'donut-chart-fill',
    labelKey: 'contextPanel.mode.context',
    descriptionKey: 'contextRail.surface.context.description',
    availability: 'always',
    defaultWidthFraction: 0.45,
  },
  {
    id: 'git',
    mode: 'git',
    icon: 'git-branch',
    labelKey: 'layout.rightSidebar.git',
    descriptionKey: 'contextRail.surface.git.description',
    availability: 'always',
    defaultWidthFraction: 0.4,
  },
  {
    id: 'pr',
    mode: 'pr',
    icon: 'git-pull-request',
    labelKey: 'contextPanel.mode.pr',
    descriptionKey: 'contextRail.surface.pr.description',
    availability: 'always',
    defaultWidthFraction: 0.45,
  },
  {
    id: 'diff',
    mode: 'diff',
    icon: 'arrow-left-right',
    labelKey: 'contextPanel.mode.diff',
    descriptionKey: 'contextRail.surface.diff.description',
    availability: 'always',
    defaultWidthFraction: 0.6,
  },
  {
    id: 'walkthrough',
    mode: 'walkthrough',
    icon: 'route',
    labelKey: 'contextPanel.mode.walkthrough',
    descriptionKey: 'contextRail.surface.walkthrough.description',
    availability: 'always',
    defaultWidthFraction: 0.6,
  },
  {
    id: 'editor',
    mode: 'file',
    icon: 'file-code',
    labelKey: 'contextPanel.mode.files',
    descriptionKey: 'contextRail.surface.editor.description',
    availability: 'always',
    defaultWidthFraction: 0.6,
  },
  {
    id: 'terminal',
    mode: 'terminal',
    icon: 'terminal-box',
    labelKey: 'layout.mainTab.terminal',
    descriptionKey: 'contextRail.surface.terminal.description',
    availability: 'always',
    defaultWidthFraction: 0.6,
  },
  {
    id: 'notes',
    mode: 'notes',
    icon: 'sticky-note',
    labelKey: 'contextRail.surface.notes',
    descriptionKey: 'contextRail.surface.notes.description',
    availability: 'always',
    defaultWidthFraction: 1 / 3,
  },
  {
    id: 'plan',
    mode: 'plan',
    icon: 'file-text',
    labelKey: 'contextPanel.mode.plan',
    descriptionKey: 'contextRail.surface.plan.description',
    availability: 'always',
    defaultWidthFraction: 0.45,
  },
  {
    id: 'browser',
    mode: 'browser',
    icon: 'global',
    labelKey: 'contextPanel.mode.browser',
    descriptionKey: 'contextRail.surface.browser.description',
    availability: 'always',
    defaultWidthFraction: 0.45,
  },
  {
    id: 'preview',
    mode: 'preview',
    icon: 'window',
    labelKey: 'contextPanel.mode.preview',
    descriptionKey: 'contextRail.surface.preview.description',
    availability: 'has-content',
    defaultWidthFraction: 0.45,
  },
  {
    id: 'chat',
    mode: 'chat',
    icon: 'chat-4',
    labelKey: 'contextPanel.mode.chat',
    descriptionKey: 'contextRail.surface.chat.description',
    availability: 'has-content',
    defaultWidthFraction: 0.45,
  },
];

const surfaceById = new Map<string, ContextSurfaceDescriptor>(CONTEXT_SURFACES.map((surface) => [surface.id, surface]));
const widthFractionByMode = new Map(CONTEXT_SURFACES.map((surface) => [surface.mode, surface.defaultWidthFraction]));

export const getContextSurfaceWidthFraction = (mode: ContextPanelMode): number => {
  if (isPluginContextPanelMode(mode)) return 0.45;
  return widthFractionByMode.get(mode) ?? 0.5;
};

const isKnownSurfaceId = (value: string, byId: ReadonlyMap<string, ContextSurfaceDescriptor>): boolean => {
  return byId.has(value);
};

/**
 * Applies a persisted user reorder on top of the default registry order:
 * unknown ids are dropped, missing surfaces are appended in default order.
 * `extras` are dynamic (guest) surfaces registered alongside the built-ins.
 */
export const sortContextSurfaces = (
  railOrder: readonly string[],
  extras: readonly ContextSurfaceDescriptor[] = [],
): ContextSurfaceDescriptor[] => {
  const all = extras.length === 0 ? CONTEXT_SURFACES : [...CONTEXT_SURFACES, ...extras];
  const byId = new Map<string, ContextSurfaceDescriptor>(all.map((surface) => [surface.id, surface]));
  const ordered: ContextSurfaceDescriptor[] = [];
  const seen = new Set<string>();

  for (const id of railOrder) {
    if (!isKnownSurfaceId(id, byId) || seen.has(id)) continue;
    const surface = byId.get(id);
    if (!surface) continue;
    seen.add(id);
    ordered.push(surface);
  }

  for (const surface of all) {
    if (!seen.has(surface.id)) ordered.push(surface);
  }

  return ordered;
};
