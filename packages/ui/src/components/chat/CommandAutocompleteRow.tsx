import React from 'react';
import { Icon } from '@/components/icon/Icon';
import { cn } from '@/lib/utils';
import { getCommandNameDisplayParts } from './commandAutocompleteDisplay';
import type { CommandInfo } from './commandAutocompleteTypes';

type CommandAutocompleteRowLabels = {
  readonly skill: string;
  readonly command: string;
  readonly system: string;
};

type CommandAutocompleteRowProps = {
  readonly command: CommandInfo;
  readonly index: number;
  readonly isSelected: boolean;
  readonly isDense: boolean;
  readonly searchQuery: string;
  readonly labels: CommandAutocompleteRowLabels;
  readonly itemRef: (element: HTMLDivElement | null) => void;
  readonly onCommandSelect: (command: CommandInfo, options?: { dismissKeyboard?: boolean }) => void;
  readonly onMouseSelect: (index: number) => void;
};

const BASE_BADGE_CLASS = 'text-[10px] leading-none uppercase font-bold tracking-tight px-1.5 py-1 rounded border flex-shrink-0';
const TYPE_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  'bg-[color-mix(in_srgb,var(--primary-base)_12%,transparent)] text-[color-mix(in_srgb,var(--primary-base)_70%,transparent)] border-[color-mix(in_srgb,var(--primary-base)_24%,transparent)]'
);
const USER_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  'bg-[color-mix(in_srgb,var(--status-success)_12%,transparent)] text-[color-mix(in_srgb,var(--status-success)_70%,transparent)] border-[color-mix(in_srgb,var(--status-success)_24%,transparent)]'
);
const PROJECT_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  'bg-[color-mix(in_srgb,var(--status-info)_12%,transparent)] text-[color-mix(in_srgb,var(--status-info)_70%,transparent)] border-[color-mix(in_srgb,var(--status-info)_24%,transparent)]'
);
const NEUTRAL_BADGE_CLASS = cn(
  BASE_BADGE_CLASS,
  'bg-[var(--surface-muted)] text-muted-foreground border-[var(--interactive-border)]/60'
);

const getCommandIcon = (command: CommandInfo) => {
  switch (command.name) {
    case 'init':
      return <Icon name="file" className="h-3.5 w-3.5 text-[var(--status-success)]" />;
    case 'undo':
      return <Icon name="arrow-go-back" className="h-3.5 w-3.5 text-[var(--status-warning)]" />;
    case 'redo':
      return <Icon name="arrow-go-forward" className="h-3.5 w-3.5 text-[var(--status-warning)]" />;
    case 'timeline':
      return <Icon name="time" className="h-3.5 w-3.5 text-muted-foreground" />;
    case 'compact':
      return <Icon name="scissors" className="h-3.5 w-3.5 text-[var(--primary-base)]" />;
    case 'review':
      return <Icon name="search-eye" className="h-3.5 w-3.5 text-[var(--status-info)]" />;
    case 'test':
    case 'build':
    case 'run':
      return <Icon name="terminal-box" className="h-3.5 w-3.5 text-[var(--status-info)]" />;
    default:
      if (command.isBuiltIn) {
        return <Icon name="flashlight" className="h-3.5 w-3.5 text-[var(--status-warning)]" />;
      }
      return <Icon name="command" className="h-3.5 w-3.5 text-muted-foreground" />;
  }
};

const CommandName = (props: { readonly name: string; readonly searchQuery: string; readonly isDense: boolean }) => {
  if (!props.isDense) {
    return <>/{props.name}</>;
  }

  const parts = getCommandNameDisplayParts(props.name, props.searchQuery);
  if (!parts.mutedPrefix) {
    return <>/{parts.emphasis}</>;
  }

  return (
    <>
      <span className="text-muted-foreground">/{parts.mutedPrefix}</span>
      <span>{parts.emphasis}</span>
    </>
  );
};

const CommandAutocompleteRowComponent = ({
  command,
  index,
  isSelected,
  isDense,
  searchQuery,
  labels,
  itemRef,
  onCommandSelect,
  onMouseSelect,
}: CommandAutocompleteRowProps) => {
  const pointerStartRef = React.useRef<{ readonly x: number; readonly y: number } | null>(null);
  const pointerMovedRef = React.useRef(false);
  const ignoreClickRef = React.useRef(false);
  const isSystem = command.isBuiltIn;
  const isOpenChamberBadge = command.isOpenChamber;
  const showTypeBadge = !isDense || !command.isSkill;

  return (
    <div
      ref={itemRef}
      role="option"
      aria-selected={isSelected}
      className={cn(
        'flex cursor-pointer gap-2 rounded-lg px-3',
        isDense ? 'min-h-9 items-center py-1.5' : 'items-start py-2',
        isSelected && 'bg-interactive-selection'
      )}
      onPointerDown={(event) => {
        if (event.pointerType !== 'touch') {
          return;
        }
        pointerStartRef.current = { x: event.clientX, y: event.clientY };
        pointerMovedRef.current = false;
      }}
      onPointerMove={(event) => {
        if (event.pointerType !== 'touch' || !pointerStartRef.current) {
          return;
        }
        const dx = event.clientX - pointerStartRef.current.x;
        const dy = event.clientY - pointerStartRef.current.y;
        if (Math.hypot(dx, dy) > 6) {
          pointerMovedRef.current = true;
        }
      }}
      onPointerUp={(event) => {
        if (event.pointerType !== 'touch') {
          return;
        }
        const didMove = pointerMovedRef.current;
        pointerStartRef.current = null;
        pointerMovedRef.current = false;
        if (didMove) {
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        ignoreClickRef.current = true;
        onCommandSelect(command, { dismissKeyboard: true });
      }}
      onPointerCancel={() => {
        pointerStartRef.current = null;
        pointerMovedRef.current = false;
      }}
      onClick={() => {
        if (ignoreClickRef.current) {
          ignoreClickRef.current = false;
          return;
        }
        onCommandSelect(command);
      }}
      onMouseMove={() => onMouseSelect(index)}
    >
      <div className={cn('shrink-0', isDense ? 'mt-0' : 'mt-0.5')}>
        {getCommandIcon(command)}
      </div>
      <div className="min-w-0 flex-1">
        <div className={cn('flex min-w-0 items-center gap-2', isDense && 'gap-1.5')}>
          <span className={cn('typography-ui-label min-w-0 truncate font-medium', isDense && 'basis-[42%] shrink-0')}>
            <CommandName name={command.name} searchQuery={searchQuery} isDense={isDense} />
          </span>
          <div className="flex shrink-0 items-center gap-1.5">
            {showTypeBadge ? (
              <span className={TYPE_BADGE_CLASS}>
                {command.isSkill ? labels.skill : labels.command}
              </span>
            ) : null}
            {isOpenChamberBadge ? (
              <span className={NEUTRAL_BADGE_CLASS}>OpenChamber</span>
            ) : isSystem ? (
              <span className={NEUTRAL_BADGE_CLASS}>{labels.system}</span>
            ) : command.scope ? (
              <span className={command.scope === 'project' ? PROJECT_BADGE_CLASS : USER_BADGE_CLASS}>
                {command.scope}
              </span>
            ) : null}
            {command.agent ? (
              <span className={NEUTRAL_BADGE_CLASS}>{command.agent}</span>
            ) : null}
          </div>
          {isDense && command.description ? (
            <span className="typography-meta min-w-0 flex-1 truncate text-muted-foreground">
              {command.description}
            </span>
          ) : null}
        </div>
        {!isDense && command.description ? (
          <div className="typography-meta mt-0.5 truncate text-muted-foreground">
            {command.description}
          </div>
        ) : null}
      </div>
    </div>
  );
};

export const CommandAutocompleteRow = React.memo(CommandAutocompleteRowComponent);
CommandAutocompleteRow.displayName = 'CommandAutocompleteRow';
