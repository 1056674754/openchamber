import type { IconName } from '@/components/icon/icons';
import type { I18nKey } from '@/lib/i18n';
import type { ContextPanelMode } from '@/stores/useUIStore';

export type ContextSurfaceId =
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

export type ContextSurfaceDescriptor = {
  id: ContextSurfaceId;
  mode: ContextPanelMode;
  icon: IconName;
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

const surfaceById = new Map(CONTEXT_SURFACES.map((surface) => [surface.id, surface]));
const surfaceIds: ReadonlySet<string> = new Set(CONTEXT_SURFACES.map((surface) => surface.id));
const widthFractionByMode = new Map(CONTEXT_SURFACES.map((surface) => [surface.mode, surface.defaultWidthFraction]));

export const getContextSurfaceWidthFraction = (mode: ContextPanelMode): number => (
  widthFractionByMode.get(mode) ?? 0.5
);

const isContextSurfaceId = (value: unknown): value is ContextSurfaceId => (
  typeof value === 'string' && surfaceIds.has(value)
);

export const sortContextSurfaces = (railOrder: readonly string[]): ContextSurfaceDescriptor[] => {
  const ordered: ContextSurfaceDescriptor[] = [];
  const seen = new Set<ContextSurfaceId>();

  for (const id of railOrder) {
    if (!isContextSurfaceId(id) || seen.has(id)) continue;
    const surface = surfaceById.get(id);
    if (!surface) continue;
    seen.add(id);
    ordered.push(surface);
  }

  for (const surface of CONTEXT_SURFACES) {
    if (!seen.has(surface.id)) ordered.push(surface);
  }

  return ordered;
};
