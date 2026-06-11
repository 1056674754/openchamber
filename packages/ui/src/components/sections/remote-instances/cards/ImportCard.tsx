/**
 * ImportCard — SSH config import candidates list + Quick Add.
 */

import React from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Icon } from "@/components/icon/Icon";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { ImportCardProps } from "./types";

export const ImportCard: React.FC<ImportCardProps> = ({
  loading,
  candidates,
  patternHost,
  patternDestination,
  patternCreating,
  onImport,
  onPatternDestinationChange,
  onPatternCreate,
  onPatternClose,
  onQuickAdd,
}) => {
  const [quickAddInput, setQuickAddInput] = React.useState("");

  const handleQuickAddSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!quickAddInput.trim()) return;
    onQuickAdd(quickAddInput.trim());
    setQuickAddInput("");
  };

  return (
    <div className="space-y-3">
      {/* Candidates list */}
      <div className="space-y-2">
        {loading ? (
          <p className="typography-meta text-muted-foreground">Loading SSH hosts...</p>
        ) : candidates.length === 0 ? (
          <p className="typography-meta text-muted-foreground">No SSH hosts found.</p>
        ) : (
          <div className="divide-y divide-[var(--interactive-border)] rounded-md border border-[var(--interactive-border)]">
            {candidates.map((candidate) => (
              <div
                key={`${candidate.source}:${candidate.host}`}
                className="flex items-center justify-between gap-3 px-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="typography-ui-label text-foreground truncate">
                    {candidate.host}
                    {candidate.pattern && (
                      <span className="typography-micro text-muted-foreground/70 ml-1">
                        (pattern)
                      </span>
                    )}
                  </div>
                  <div className="typography-micro text-muted-foreground/70">{candidate.source}</div>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="xs"
                  className="!font-normal shrink-0"
                  onClick={() => onImport(candidate.host, candidate.pattern)}
                >
                  {candidate.pattern ? (
                    <>
                      <Icon name="edit-2" className="h-3.5 w-3.5" />
                      Fill in
                    </>
                  ) : (
                    <>
                      <Icon name="download" className="h-3.5 w-3.5" />
                      Import
                    </>
                  )}
                </Button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Quick Add */}
      <div>
        <h4 className="typography-ui-header font-medium text-foreground mb-2">Quick Add</h4>
        <form className="flex items-center gap-2" onSubmit={handleQuickAddSubmit}>
          <Input
            className="h-7 flex-1"
            value={quickAddInput}
            onChange={(e) => setQuickAddInput(e.target.value)}
            placeholder="ssh user@host.example.com"
          />
          <Button
            type="submit"
            variant="default"
            size="xs"
            className="!font-normal shrink-0"
            disabled={!quickAddInput.trim()}
          >
            <Icon name="add" className="h-3.5 w-3.5" />
            Add
          </Button>
        </form>
      </div>

      {/* Pattern host dialog */}
      <Dialog
        open={patternHost !== null}
        onOpenChange={(open) => {
          if (!open) onPatternClose();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Fill in SSH destination</DialogTitle>
            <DialogDescription>
              {patternHost
                ? `Enter a concrete SSH command for "${patternHost}":`
                : "Enter a concrete SSH destination:"}
            </DialogDescription>
          </DialogHeader>
          <form className="space-y-3" onSubmit={(e) => {
            e.preventDefault();
            onPatternCreate();
          }}>
            <Input
              value={patternDestination}
              onChange={(e) => onPatternDestinationChange(e.target.value)}
              placeholder="ssh user@host.example.com"
              autoFocus
            />
            <div className="flex items-center justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={onPatternClose}
                disabled={patternCreating}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                size="xs"
                className="!font-normal"
                disabled={patternCreating || !patternDestination.trim()}
              >
                {patternCreating ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
};
