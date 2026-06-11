/**
 * ForwardCard — Port forwarding list with compact per-forward cards.
 * Desktop only. Each forward shows type selector, host:port pairs,
 * enable toggle, remove button, and open-local button.
 */

import React from "react";
import { Collapsible } from "@/components/ui/collapsible";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Icon } from "@/components/icon/Icon";
import type { ForwardCardProps, DesktopSshPortForward } from "./types";

/* ─── helpers ─────────────────────────────────────────────────── */

const CARD_CLASSES =
  "rounded-lg border border-[var(--interactive-border)] bg-[var(--surface-elevated)] p-3 space-y-2";
const ROW_CLASSES = "flex flex-col gap-1.5 py-1 md:flex-row md:items-center md:gap-6";
const LABEL_CLASSES = "typography-ui-label text-foreground w-32 shrink-0";

function formatEndpoint(host: string, port: number | undefined): string {
  if (port === undefined || port === 0) return `${host}:—`;
  return `${host}:${port}`;
}

/* ─── ForwardRowCard ──────────────────────────────────────────── */

interface ForwardRowCardProps {
  forward: DesktopSshPortForward;
  onUpdate: (updater: (f: DesktopSshPortForward) => DesktopSshPortForward) => void;
  onRemove: () => void;
  onOpenLocal: () => void;
  isExpanded: boolean;
  onToggle: () => void;
  isReady: boolean;
}

function ForwardRowCard({
  forward,
  onUpdate,
  onRemove,
  onOpenLocal,
  isExpanded,
  onToggle,
  isReady,
}: ForwardRowCardProps) {
  const localLabel = forward.type === "remote" ? "Local target" : "Local listen";
  const remoteLabel = forward.type === "remote" ? "Remote listen" : "Remote target";

  const localHost = forward.localHost || "localhost";
  const remoteHost = forward.remoteHost || "localhost";

  const canOpen =
    forward.type === "local" &&
    typeof forward.localPort === "number" &&
    forward.localPort > 0;

  const dotClass =
    isReady && forward.enabled
      ? "bg-[var(--status-success)]"
      : "bg-muted-foreground/40";

  /* arrow rotation for collapsible */
  const arrowRotation = isExpanded ? "rotate-180" : "";

  return (
    <div className={CARD_CLASSES}>
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <button
            type="button"
            className="flex items-center gap-2 hover:bg-[var(--interactive-hover)]/50 rounded px-1 py-0.5 -ml-1"
            onClick={onToggle}
            aria-label={isExpanded ? "Collapse forward" : "Expand forward"}
          >
            <Icon
              name="arrow-down-s"
              className={`h-4 w-4 text-muted-foreground transition-transform ${arrowRotation}`}
            />
            <span className={`h-2 w-2 rounded-full shrink-0 ${dotClass}`} />
            <span className="typography-ui-label text-foreground truncate">
              {formatEndpoint(localHost, forward.localPort)}
              {" "}
              <span className="text-muted-foreground">
                {forward.type === "remote" ? "←" : "→"}
              </span>
              {" "}
              {formatEndpoint(remoteHost, forward.remotePort)}
            </span>
          </button>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {/* Type chip */}
          <Select value={forward.type} onValueChange={(v) => onUpdate((f) => ({ ...f, type: v as DesktopSshPortForward["type"] }))}>
            <SelectTrigger className="h-6 w-fit min-w-[80px] !text-xs">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="local">local</SelectItem>
              <SelectItem value="remote">remote</SelectItem>
              <SelectItem value="dynamic">dynamic</SelectItem>
            </SelectContent>
          </Select>

          {/* Enabled toggle */}
          <Switch
            checked={forward.enabled}
            onCheckedChange={(checked) => onUpdate((f) => ({ ...f, enabled: checked }))}
            aria-label="Toggle forward"
          />

          {/* Open local */}
          {canOpen && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="!font-normal h-6 w-6 px-0"
              onClick={onOpenLocal}
              aria-label="Open local endpoint"
              title="Open in browser"
            >
              <Icon name="external-link" className="h-3.5 w-3.5" />
            </Button>
          )}

          {/* Remove */}
          <Button
            type="button"
            variant="ghost"
            size="xs"
            className="!font-normal h-6 w-6 px-0 text-[var(--status-error)] hover:text-[var(--status-error)]"
            onClick={onRemove}
            aria-label="Remove forward"
          >
            <Icon name="delete-bin" className="h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Expanded detail */}
      <Collapsible open={isExpanded}>
        {isExpanded && (
          <div className="pt-2 space-y-2 border-t border-[var(--surface-subtle)]">
            <p className="typography-meta text-muted-foreground">
              {forward.type === "remote"
                ? "Local host and port on your machine that receives traffic from remote -R listener."
                : forward.type === "dynamic"
                  ? "SOCKS proxy — all traffic routed through the SSH tunnel."
                  : "Local host and port where this forward listens on your machine."}
            </p>

            {/* Local */}
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>{localLabel}</span>
              <div className="flex items-center gap-1 w-full md:max-w-sm">
                <Input
                  className="h-7 flex-1"
                  value={forward.localHost || ""}
                  onChange={(e) =>
                    onUpdate((f) => ({ ...f, localHost: e.target.value }))
                  }
                  placeholder="host"
                />
                <span className="text-muted-foreground">:</span>
                <Input
                  className="h-7 w-20"
                  type="text"
                  inputMode="numeric"
                  value={forward.localPort ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") {
                      onUpdate((f) => ({ ...f, localPort: undefined }));
                    } else {
                      const n = parseInt(v, 10);
                      if (Number.isFinite(n)) {
                        onUpdate((f) => ({ ...f, localPort: n }));
                      }
                    }
                  }}
                  placeholder="port"
                />
              </div>
            </div>

            {/* Remote */}
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>{remoteLabel}</span>
              <div className="flex items-center gap-1 w-full md:max-w-sm">
                <Input
                  className="h-7 flex-1"
                  value={forward.remoteHost || ""}
                  onChange={(e) =>
                    onUpdate((f) => ({ ...f, remoteHost: e.target.value }))
                  }
                  placeholder="host"
                />
                <span className="text-muted-foreground">:</span>
                <Input
                  className="h-7 w-20"
                  type="text"
                  inputMode="numeric"
                  value={forward.remotePort ?? ""}
                  onChange={(e) => {
                    const v = e.target.value;
                    if (v === "") {
                      onUpdate((f) => ({ ...f, remotePort: undefined }));
                    } else {
                      const n = parseInt(v, 10);
                      if (Number.isFinite(n)) {
                        onUpdate((f) => ({ ...f, remotePort: n }));
                      }
                    }
                  }}
                  placeholder="port"
                />
              </div>
            </div>
          </div>
        )}
      </Collapsible>
    </div>
  );
}

/* ─── ForwardCard ─────────────────────────────────────────────── */

export function ForwardCard({
  forwards,
  expandedForwards,
  onToggleExpand,
  onUpdateForward,
  onRemoveForward,
  onAddForward,
  onOpenLocal,
  isDesktop,
}: ForwardCardProps) {
  if (!isDesktop) return null;

  return (
    <div className="border-t border-[var(--surface-subtle)] pt-8">
      <div className="mb-1 px-1 space-y-0.5">
        <h3 className="typography-ui-header font-medium text-foreground">
          Port Forwarding
        </h3>
        <p className="typography-meta text-muted-foreground">
          Additional SSH port forwards beyond the main tunnel
        </p>
      </div>

      <section className="space-y-2 px-2 pb-2 pt-0">
        {/* Add button in header area */}
        <div className="flex justify-end mb-2 px-1">
          <Button
            type="button"
            variant="outline"
            size="xs"
            className="!font-normal"
            onClick={onAddForward}
          >
            <Icon name="add" className="h-3.5 w-3.5" />
            Add
          </Button>
        </div>

        {forwards.length === 0 ? (
          <p className="typography-micro text-muted-foreground/80 px-1">
            No extra port forwards.
          </p>
        ) : (
          forwards.map((forward) => (
            <ForwardRowCard
              key={forward.id}
              forward={forward}
              isExpanded={!!expandedForwards[forward.id]}
              isReady={false}
              onToggle={() => onToggleExpand(forward.id)}
              onUpdate={(updater) => onUpdateForward(forward.id, updater)}
              onRemove={() => onRemoveForward(forward.id)}
              onOpenLocal={() => onOpenLocal(forward)}
            />
          ))
        )}
      </section>
    </div>
  );
}
