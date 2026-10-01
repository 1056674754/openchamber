import React from 'react';
import { Checkbox } from '@/components/ui/checkbox';
import { Radio } from '@/components/ui/radio';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { SettingsInfoHint } from './SettingsInfoHint';

interface SettingsSectionProps {
  /** Section content */
  children: React.ReactNode;
  /** Optional section title */
  title?: string;
  /** Optional section description */
  description?: string;
  /** Alias of `description` used by ported upstream sections. */
  info?: React.ReactNode;
  /** If true, adds a top border divider */
  divider?: boolean;
  /** Stable settings-navigation anchor id. */
  settingsItem?: string;
  /** Content rendered next to the title (e.g. a switch). */
  titleAccessory?: React.ReactNode;
  /** Action button(s) rendered at the end of the header row. */
  headerAction?: React.ReactNode;
  /** Class applied to the content wrapper. */
  contentClassName?: string;
  /** Additional className */
  className?: string;
}

/**
 * Standard section wrapper for settings page content.
 * Provides consistent spacing and optional divider.
 *
 * @example
 * <SettingsSection title="Appearance" description="Customize the look and feel">
 *   <ThemeSelector />
 *   <FontSizeSelector />
 * </SettingsSection>
 *
 * <SettingsSection divider>
 *   <DangerZoneSettings />
 * </SettingsSection>
 */
export const SettingsSection: React.FC<SettingsSectionProps> = ({
  children,
  title,
  description,
  info,
  divider = false,
  settingsItem,
  titleAccessory,
  headerAction,
  contentClassName,
  className,
}) => {
  const sectionDescription = description ?? info;
  return (
    <div
      data-settings-item={settingsItem}
      className={cn(
        divider && 'border-t border-border/40 pt-6',
        className
      )}
    >
      {(title || sectionDescription || titleAccessory != null || headerAction != null) && (
        <div className="mb-4 flex items-start justify-between gap-4">
          <div className="min-w-0 space-y-1">
          {title && (
            <h3 className="typography-ui-header font-semibold text-foreground">
              {title}
            </h3>
          )}
            {sectionDescription && (
              <p className="typography-meta text-muted-foreground">
                {sectionDescription}
              </p>
            )}
          </div>
          {titleAccessory != null || headerAction != null ? (
            <div className="flex shrink-0 items-center gap-2">
              {titleAccessory}
              {headerAction}
            </div>
          ) : null}
        </div>
      )}
      <div className={contentClassName}>{children}</div>
    </div>
  );
};

// --- Ported shared settings primitives (from upstream SettingsSection) ---

export const SETTINGS_FIELD_LABEL_CLASS =
  'typography-settings-field-label text-foreground';

/** Compact reset / icon action next to a settings control (matches h-8 controls). (upstream 5181bcd33) */
export const SETTINGS_ICON_BUTTON_CLASS =
  'h-8 w-8 px-0 text-muted-foreground hover:text-foreground';

/** Split-pane sidebar panel title. [fork-port] fork has no settings-typography tokens yet. */
export const SETTINGS_PANEL_TITLE_CLASS = 'text-base font-semibold text-foreground';

const SETTINGS_TRIGGER_WIDTH_CLASS = 'w-full min-w-[22ch] max-w-[40ch]';
export const SETTINGS_SELECT_TRIGGER_CLASS = SETTINGS_TRIGGER_WIDTH_CLASS;
export const SETTINGS_SELECT_SIZE = 'sm' as const;
export const SETTINGS_SELECT_ROW_TRIGGER_CLASS = SETTINGS_TRIGGER_WIDTH_CLASS;
export const SETTINGS_FIELDS_STACK_CLASS = 'space-y-4';
export const SETTINGS_HELPER_CLASS = 'typography-meta text-muted-foreground';

/** Custom dropdown triggers (ModelSelector / AgentSelector) in settings pages. */
// eslint-disable-next-line react-refresh/only-export-components
export const SETTINGS_CUSTOM_TRIGGER_CLASS = 'w-full';

/** Compact checkbox / radio list stack. */
export const SETTINGS_OPTION_STACK_CLASS = 'space-y-1.5';

/** Supporting copy under page or section titles. */
export const SETTINGS_DESCRIPTION_CLASS = 'typography-meta text-muted-foreground';

interface SettingsTwoColumnProps {
  children: React.ReactNode;
  className?: string;
}

/** Responsive two-column settings grid used when space allows. */
export const SettingsTwoColumn: React.FC<SettingsTwoColumnProps> = ({
  children,
  className,
}) => {
  return (
    <div className={cn('grid grid-cols-1 gap-6 @3xl:grid-cols-2 @3xl:gap-10', className)}>
      {children}
    </div>
  );
};

interface SettingsStackedFieldProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Helper text hidden behind an info icon next to the label. */
  info?: React.ReactNode;
  /** Where helper text sits relative to the control. @default 'before' */
  descriptionPlacement?: 'before' | 'after';
  children: React.ReactNode;
  settingsItem?: string;
  className?: string;
  controlClassName?: string;
}

/**
 * Label (+ optional description) above a control — for two-column cells.
 * Prefer this over SettingsFieldRow inside SettingsTwoColumn (FieldRow overflows half-width columns).
 */
export const SettingsStackedField: React.FC<SettingsStackedFieldProps> = ({
  label,
  description,
  info,
  descriptionPlacement = 'before',
  children,
  settingsItem,
  className,
  controlClassName,
}) => {
  const descriptionNode =
    description != null ? (
      <p className={SETTINGS_HELPER_CLASS}>{description}</p>
    ) : null;

  return (
    <div data-settings-item={settingsItem} className={cn('space-y-2', className)}>
      <div className="space-y-0.5">
        <div className="flex items-center gap-1.5">
          <div className={SETTINGS_FIELD_LABEL_CLASS}>{label}</div>
          {info != null ? <SettingsInfoHint>{info}</SettingsInfoHint> : null}
        </div>
        {descriptionPlacement === 'before' ? descriptionNode : null}
      </div>
      <div className={cn('flex min-w-0 max-w-[24rem] items-center gap-2', controlClassName)}>{children}</div>
      {descriptionPlacement === 'after' ? descriptionNode : null}
    </div>
  );
};
interface SettingsFieldRowProps {
  label: React.ReactNode;
  description?: React.ReactNode;
  /** Helper text hidden behind an info icon next to the label. */
  info?: React.ReactNode;
  children: React.ReactNode;
  settingsItem?: string;
  className?: string;
  controlClassName?: string;
  /** Align control to the trailing edge on desktop. @default true */
  alignEnd?: boolean;
}

interface SettingsControlGroupProps {
  title?: React.ReactNode;
  description?: React.ReactNode;
  /** Helper text hidden behind an info icon next to the group title. */
  info?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  contentClassName?: string;
  settingsItem?: string;
}

export const SettingsControlGroup: React.FC<SettingsControlGroupProps> = ({
  title,
  description,
  info,
  children,
  className,
  contentClassName,
  settingsItem,
}) => {
  return (
    <div data-settings-item={settingsItem} className={cn('space-y-2', className)}>
      {title != null || description != null || info != null ? (
        <div className="space-y-0.5">
          {title != null ? (
            <div className="flex items-center gap-1.5">
              <SettingsGroupTitle>{title}</SettingsGroupTitle>
              {info != null ? <SettingsInfoHint>{info}</SettingsInfoHint> : null}
            </div>
          ) : null}
          {description != null ? (
            <p className={SETTINGS_HELPER_CLASS}>{description}</p>
          ) : null}
        </div>
      ) : null}
      <div className={cn(contentClassName)}>{children}</div>
    </div>
  );
}

export const SettingsFieldRow: React.FC<SettingsFieldRowProps> = ({
  label,
  description,
  info,
  children,
  settingsItem,
  className,
  controlClassName,
  alignEnd = true,
}) => {
  return (
    <div
      data-settings-item={settingsItem}
      className={cn(
        'flex flex-col gap-2 py-0.5 @xl:flex-row @xl:items-center @xl:gap-8',
        className,
      )}
    >
      <div className="min-w-0 @xl:w-56 @xl:shrink-0">
        <div className="flex min-w-0 items-center gap-1.5">
          <div className={cn('min-w-0 truncate', SETTINGS_FIELD_LABEL_CLASS)}>{label}</div>
          {info != null ? <SettingsInfoHint>{info}</SettingsInfoHint> : null}
        </div>
        {description != null ? (
          <p className={cn(SETTINGS_HELPER_CLASS, 'mt-0.5')}>{description}</p>
        ) : null}
      </div>
      <div
        className={cn(
          'flex min-w-0 flex-1 items-center gap-2 @xl:w-fit @xl:flex-none',
          alignEnd && '@xl:justify-end',
          controlClassName,
        )}
      >
        {children}
      </div>
    </div>
  );
}



interface SettingsGroupTitleProps {
  children: React.ReactNode;
  className?: string;
  as?: 'h2' | 'h3' | 'div';
}

export const SettingsGroupTitle: React.FC<SettingsGroupTitleProps> = ({
  children,
  className,
  as: Tag = 'h3',
}) => {
  return (
    <Tag className={cn(SETTINGS_GROUP_TITLE_CLASS, className)}>
      {children}
    </Tag>
  );
}

const SETTINGS_GROUP_TITLE_CLASS =
  'typography-settings-group-title text-foreground';

interface SettingsCheckboxRowProps {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  disabled?: boolean;
  ariaLabel?: string;
  settingsItem?: string;
  className?: string;
  labelAccessory?: React.ReactNode;
  /** Helper text hidden behind an info icon next to the label. */
  info?: React.ReactNode;
}

/** Shared checkbox setting row with keyboard support. */
export const SettingsCheckboxRow: React.FC<SettingsCheckboxRowProps> = ({
  checked,
  onChange,
  label,
  description,
  disabled = false,
  ariaLabel,
  settingsItem,
  className,
  labelAccessory,
  info,
}) => {
  const toggle = () => {
    if (!disabled) onChange(!checked);
  };

  const hasDescription = description != null;

  return (
    <div
      data-settings-item={settingsItem}
      className={cn(
        'group flex cursor-pointer gap-2 py-0.5',
        hasDescription ? 'items-start' : 'items-center',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={checked}
      aria-disabled={disabled || undefined}
      onClick={toggle}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          toggle();
        }
      }}
    >
      <Checkbox
        checked={checked}
        onChange={onChange}
        disabled={disabled}
        ariaLabel={ariaLabel}
      />
      <div className="flex min-w-0 flex-col">
        <div className="flex min-w-0 items-center gap-1.5">
          <span className={SETTINGS_FIELD_LABEL_CLASS}>{label}</span>
          {labelAccessory}
          {info != null ? <SettingsInfoHint>{info}</SettingsInfoHint> : null}
        </div>
        {hasDescription ? (
          <span className={SETTINGS_HELPER_CLASS}>{description}</span>
        ) : null}
      </div>
    </div>
  );
};

interface SettingsRadioOptionProps {
  selected: boolean;
  onSelect: () => void;
  label: React.ReactNode;
  description?: React.ReactNode;
  ariaLabel?: string;
  disabled?: boolean;
  className?: string;
}

/** Single radio option row used inside SettingsRadioGroup (upstream segb 1bc709ed0). */
export const SettingsRadioOption: React.FC<SettingsRadioOptionProps> = ({
  selected,
  onSelect,
  label,
  description,
  ariaLabel,
  disabled = false,
  className,
}) => {
  return (
    <div
      className={cn(
        'flex cursor-pointer gap-2 py-0.5',
        description != null ? 'items-start' : 'items-center',
        disabled && 'cursor-not-allowed opacity-60',
        className,
      )}
      role="button"
      tabIndex={disabled ? -1 : 0}
      aria-pressed={selected}
      aria-disabled={disabled || undefined}
      onClick={() => {
        if (!disabled) onSelect();
      }}
      onKeyDown={(event) => {
        if (event.key === ' ' || event.key === 'Enter') {
          event.preventDefault();
          if (!disabled) onSelect();
        }
      }}
    >
      <Radio
        checked={selected}
        onChange={onSelect}
        disabled={disabled}
        ariaLabel={ariaLabel}
        className={description != null ? 'mt-0.5' : undefined}
      />
      <div className="flex min-w-0 flex-col">
        <span className="typography-ui-label font-normal text-foreground">
          {label}
        </span>
        {description != null ? (
          <span className={SETTINGS_HELPER_CLASS}>{description}</span>
        ) : null}
      </div>
    </div>
  );
};

interface SettingsRadioGroupProps {
  'aria-label': string;
  children: React.ReactNode;
  className?: string;
}

/** Accessible radio group wrapper with compact vertical spacing. */
export const SettingsRadioGroup: React.FC<SettingsRadioGroupProps> = ({
  'aria-label': ariaLabel,
  children,
  className,
}) => {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={cn(SETTINGS_OPTION_STACK_CLASS, className)}>
      {children}
    </div>
  );
};

interface SettingsChipOption<T extends string> {
  value: T;
  label: React.ReactNode;
  disabled?: boolean;
  /**
   * Shown on hover (long-press on touch). The popup stays open while the
   * pointer is on it, so it may carry a link. Keep what the user must read
   * visible elsewhere: touch users rarely long-press.
   */
  tooltip?: React.ReactNode;
}

interface SettingsChipGroupProps<T extends string> {
  value: T;
  options: Array<SettingsChipOption<T>>;
  onChange: (value: T) => void;
  className?: string;
  'aria-label'?: string;
}

/** Compact chip / segmented enum picker (upstream segb 1bc709ed0). */
export function SettingsChipGroup<T extends string>({
  value,
  options,
  onChange,
  className,
  'aria-label': ariaLabel,
}: SettingsChipGroupProps<T>) {
  return (
    <div
      role="group"
      aria-label={ariaLabel}
      className={cn('flex flex-wrap items-center gap-1', className)}
    >
      {options.map((option) => {
        const chip = (
          <Button
            key={option.value}
            type="button"
            variant="chip"
            size="xs"
            disabled={option.disabled}
            aria-pressed={value === option.value}
            className="!font-normal"
            onClick={() => onChange(option.value)}
          >
            {option.label}
          </Button>
        );
        if (!option.tooltip) return chip;
        return (
          <Tooltip key={option.value}>
            {/* A disabled button gets no hover events, so its tooltip (usually
                the reason it is disabled) hangs on a wrapper instead. */}
            <TooltipTrigger asChild>
              {option.disabled ? <span className="inline-flex" tabIndex={0}>{chip}</span> : chip}
            </TooltipTrigger>
            <TooltipContent side="top" sideOffset={6} className="max-w-xs">
              {option.tooltip}
            </TooltipContent>
          </Tooltip>
        );
      })}
    </div>
  );
}
