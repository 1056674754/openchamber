/**
 * ChangeBar — Sticky bottom bar showing pending changes with save/discard.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Icon } from "@/components/icon/Icon";
import type { ChangeBarProps } from "./types";

export const ChangeBar: React.FC<ChangeBarProps> = ({
  visible,
  changeCount,
  changeSummary,
  onSave,
  onDiscard,
  error,
  saving,
}) => {
  if (!visible) return null;

  return (
    <div className="sticky bottom-0 -mx-3 sm:-mx-6 bg-[var(--surface-background)] border-t border-[var(--interactive-border)] px-3 sm:px-6 py-3">
      <div className="flex items-center gap-2">
        <div className="flex items-center gap-1.5 typography-meta text-foreground">
          <Icon name="information" className="h-3.5 w-3.5 text-[var(--primary-base)]" />
          <span>
            {changeCount} {changeCount === 1 ? "change" : "changes"}
            {changeSummary ? ` — ${changeSummary}` : ""}
          </span>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {error ? (
            <span className="typography-meta text-[var(--status-error)] mr-2">{error}</span>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="!font-normal"
            onClick={onDiscard}
            disabled={saving}
          >
            Discard
          </Button>
          <Button
            type="button"
            variant="default"
            size="xs"
            className="!font-normal"
            onClick={onSave}
            disabled={saving}
          >
            {saving ? (
              <>
                <Icon name="loader-4" className="h-3.5 w-3.5 animate-spin" />
                Saving...
              </>
            ) : (
              "Save Changes"
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};
