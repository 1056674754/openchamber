import React from 'react';
import { cn } from '@/lib/utils';

interface SettingsSectionProps {
  /** Section content */
  children: React.ReactNode;
  /** Optional section title */
  title?: string;
  /** Optional section description */
  description?: string;
  /** Alias of `description` used by ported upstream sections. */
  info?: string;
  /** If true, adds a top border divider */
  divider?: boolean;
  /** Stable settings-navigation anchor id. */
  settingsItem?: string;
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
      {(title || sectionDescription) && (
        <div className="mb-4 space-y-1">
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
      )}
      <div className={contentClassName}>{children}</div>
    </div>
  );
};

// --- Ported shared settings primitives (from upstream SettingsSection) ---
import { SettingsInfoHint } from './SettingsInfoHint';

export const SETTINGS_FIELD_LABEL_CLASS =
  'typography-settings-field-label text-foreground';

const SETTINGS_TRIGGER_WIDTH_CLASS = 'w-full min-w-[22ch] max-w-[40ch]';
export const SETTINGS_SELECT_TRIGGER_CLASS = SETTINGS_TRIGGER_WIDTH_CLASS;
export const SETTINGS_SELECT_SIZE = 'settings' as const;
export const SETTINGS_SELECT_ROW_TRIGGER_CLASS = SETTINGS_TRIGGER_WIDTH_CLASS;
export const SETTINGS_FIELDS_STACK_CLASS = 'space-y-4';
export const SETTINGS_HELPER_CLASS = 'typography-meta text-muted-foreground';
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
