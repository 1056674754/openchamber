import React from 'react';
import { ScrollableOverlay } from '@/components/ui/ScrollableOverlay';
import { cn } from '@/lib/utils';

interface SettingsPageLayoutProps {
  /** Page content */
  children: React.ReactNode;
  /** Optional page title shown above settings content. */
  title?: React.ReactNode;
  /** Optional supporting description under the page title. */
  description?: React.ReactNode;
  /** Accepted for upstream parity: save failures already surface app-wide
   *  through the settings-save-failed toast (`useSettingsSaveFailureToast`). */
  showSaveStatus?: boolean;
  /** Additional className for the content container */
  className?: string;
  /** Additional className for the outer ScrollableOverlay */
  outerClassName?: string;
}

/**
 * Standard layout wrapper for settings page content.
 * Provides scrolling and centered max-width container.
 *
 * @example
 * <SettingsPageLayout>
 *   <SettingsSection title="General">
 *     <SomeSettingsForm />
 *   </SettingsSection>
 *   <SettingsSection title="Advanced" divider>
 *     <OtherSettingsForm />
 *   </SettingsSection>
 * </SettingsPageLayout>
 */
export const SettingsPageLayout: React.FC<SettingsPageLayoutProps> = ({
  children,
  className,
  outerClassName,
  title,
  description,
}) => {
  return (
    <ScrollableOverlay
      outerClassName={cn('h-full', outerClassName)}
      className="w-full"
    >
      <div
        className={cn(
          'mx-auto max-w-3xl space-y-6 p-3 sm:p-6 sm:pt-8',
          className
        )}
      >
        {title != null || description != null ? (
          <div className="space-y-1">
            {title != null ? <h1 className="typography-ui-header font-semibold text-foreground">{title}</h1> : null}
            {description != null ? <p className="typography-meta text-muted-foreground">{description}</p> : null}
          </div>
        ) : null}
        {children}
      </div>
    </ScrollableOverlay>
  );
};
