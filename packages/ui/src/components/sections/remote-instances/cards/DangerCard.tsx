/**
 * DangerCard — Isolated "Remove this instance" action.
 * Uses theme tokens for destructive styling.
 */

import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon/Icon";
import type { DangerCardProps } from "./types";

export function DangerCard({ onRemove, instanceLabel }: DangerCardProps) {
  const handleRemove = () => {
    const confirmed = window.confirm(
      `Permanently remove "${instanceLabel}" and all its configuration?\n\nThis action cannot be undone.`,
    );
    if (confirmed) {
      onRemove();
    }
  };

  return (
    <div className="border-t border-[var(--surface-subtle)] pt-8">
      <div className="mb-1 px-1 space-y-0.5">
        <h3 className="typography-ui-header font-medium text-[var(--status-error)]">
          Danger Zone
        </h3>
        <p className="typography-meta text-muted-foreground">
          This will permanently remove this instance and all its configuration.
        </p>
      </div>

      <section className="p-2">
        <Button
          type="button"
          variant="outline"
          size="xs"
          className="!font-normal text-[var(--status-error)] border-[var(--status-error)]/30 hover:bg-[var(--status-error)]/10 hover:border-[var(--status-error)]/50 hover:text-[var(--status-error)]"
          onClick={handleRemove}
        >
          <Icon name="delete-bin" className="h-3.5 w-3.5" />
          Remove this instance
        </Button>
      </section>
    </div>
  );
}
