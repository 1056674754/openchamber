/**
 * ConfigCard — Instance configuration and authentication settings.
 *
 * Desktop: SSH command, tunnel, remote server, and SSH auth fields.
 * Web: URL, nickname, timeout, and password/bearer auth.
 */

import React from "react";
import { Switch } from "@/components/ui/switch";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { NumberInput } from "@/components/ui/number-input";
import { Icon } from "@/components/icon/Icon";
import { useI18n } from "@/lib/i18n";
import type { ConfigCardProps } from "./types";

/* ─── helpers ─────────────────────────────────────────────────── */

const SECTION_CLASSES = "space-y-3 p-2";
const HEADER_CLASSES = "mb-1 px-1 space-y-0.5";
const ROW_CLASSES = "flex flex-col gap-1.5 py-1.5 md:flex-row md:items-center md:gap-8";
const LABEL_CLASSES = "typography-ui-label text-foreground w-56 shrink-0";

interface SubSectionProps {
  title: string;
  description?: string;
  children: React.ReactNode;
}

function SubSection({ title, description, children }: SubSectionProps) {
  return (
    <div>
      <div className={HEADER_CLASSES}>
        <h4 className="typography-ui-header font-medium text-foreground">{title}</h4>
        {description && (
          <p className="typography-meta text-muted-foreground">{description}</p>
        )}
      </div>
      <section className={SECTION_CLASSES}>{children}</section>
    </div>
  );
}

/* ─── ConfigCard ─────────────────────────────────────────────── */

export function ConfigCard({
  isDesktop,
  sshCommand,
  onSshCommandChange,
  nickname,
  onNicknameChange,
  connectionTimeoutSec,
  onConnectionTimeoutChange,
  enabled,
  onEnabledChange,

  // Remote Server
  remoteMode,
  onRemoteModeChange,
  keepRunning,
  onKeepRunningChange,
  preferredRemotePort,
  onPreferredRemotePortChange,
  installMethod,
  onInstallMethodChange,
  releaseDownloadUrl,
  onReleaseDownloadUrlChange,
  remoteBindHost,
  onRemoteBindHostChange,

  // Main Tunnel
  bindHost,
  onBindHostChange,
  preferredLocalPort,
  onPreferredLocalPortChange,

  // Auth
  authType,
  onAuthTypeChange,
  authValue,
  onAuthValueChange,
  sshPasswordEnabled,
  onSshPasswordEnabledChange,
  sshPasswordValue,
  onSshPasswordValueChange,
  uiPasswordEnabled,
  onUiPasswordEnabledChange,
  uiPasswordValue,
  onUiPasswordValueChange,

  // Web URL
  webUrl,
  onWebUrlChange,
  requestHeaderEntries,
  onRequestHeaderEntriesChange,
}: ConfigCardProps) {
  const { t } = useI18n();
  return (
    <div className="border-t border-[var(--surface-subtle)] pt-8">
      <div className={HEADER_CLASSES}>
        <h3 className="typography-ui-header font-medium text-foreground">Configuration</h3>
        <p className="typography-meta text-muted-foreground">
          Instance connection settings and authentication
        </p>
      </div>

      <div className="mb-6">
        <SubSection title="Endpoint">
          {/* SSH Command — desktop only */}
          {isDesktop ? (
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>SSH Command</span>
              <Input
                className="h-7 md:max-w-xl font-mono text-sm"
                value={sshCommand}
                onChange={(e) => onSshCommandChange(e.target.value)}
                placeholder="ssh user@host"
              />
            </div>
          ) : (
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>URL</span>
              <Input
                className="h-7 md:max-w-xl"
                value={webUrl}
                onChange={(e) => onWebUrlChange(e.target.value)}
                placeholder="https://remote-host.example.com:4096"
              />
            </div>
          )}

          {/* Nickname */}
          <div className={ROW_CLASSES}>
            <span className={LABEL_CLASSES}>Nickname</span>
            <Input
              className="h-7 md:max-w-sm"
              value={isDesktop ? nickname : nickname}
              onChange={(e) => (isDesktop ? onNicknameChange(e.target.value) : onNicknameChange(e.target.value))}
              placeholder="My Dev Server"
            />
          </div>

          {/* Timeout */}
          <div className={ROW_CLASSES}>
            <span className={LABEL_CLASSES}>Timeout</span>
            <NumberInput
              value={connectionTimeoutSec}
              onValueChange={onConnectionTimeoutChange}
              min={5}
              max={240}
              step={1}
            />
            <span className="typography-meta text-muted-foreground ml-1">sec</span>
          </div>

          {/* Enabled toggle */}
          <div className={ROW_CLASSES}>
            <span className={LABEL_CLASSES}>Enabled</span>
            <div className="flex items-center gap-2">
              <Switch checked={enabled} onCheckedChange={onEnabledChange} />
            </div>
          </div>
        </SubSection>
      </div>

      {/* Remote Server — desktop only, shown for managed mode */}
      {isDesktop && remoteMode && (
        <div className="mb-6 border-t border-[var(--surface-subtle)] pt-6">
          <SubSection title="Remote Server">
            {/* Mode */}
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>Mode</span>
              <Select value={remoteMode} onValueChange={onRemoteModeChange!}>
                <SelectTrigger className="h-7 w-fit min-w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="managed">Managed</SelectItem>
                  <SelectItem value="external">External</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Remote Port */}
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>Remote Port</span>
              <NumberInput
                value={preferredRemotePort}
                onValueChange={onPreferredRemotePortChange!}
                min={1}
                max={65535}
                step={1}
                onClear={() => onPreferredRemotePortChange?.(undefined)}
                emptyLabel="Auto"
              />
            </div>

            {remoteMode === "managed" && (
              <>
                <div className={ROW_CLASSES}>
                  <span className={LABEL_CLASSES}>Keep server running</span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={keepRunning ?? false}
                      onCheckedChange={onKeepRunningChange!}
                    />
                  </div>
                </div>

                {/* Install Method */}
                <div className={ROW_CLASSES}>
                  <span className={LABEL_CLASSES}>Install Method</span>
                  <Select value={installMethod} onValueChange={onInstallMethodChange!}>
                    <SelectTrigger className="h-7 w-fit min-w-[140px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="auto">{t("settings.remoteInstances.page.field.installMethodAuto")}</SelectItem>
                      <SelectItem value="bun">Bun</SelectItem>
                      <SelectItem value="npm">npm</SelectItem>
                      <SelectItem value="download_release">{t("settings.remoteInstances.page.field.installMethodDownloadRelease")}</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className={ROW_CLASSES}>
                  <span className={LABEL_CLASSES}>{t("settings.remoteInstances.page.field.remoteLanAccess")}</span>
                  <div className="flex items-center gap-2">
                    <Switch
                      checked={remoteBindHost === "0.0.0.0"}
                      onCheckedChange={(checked) => onRemoteBindHostChange?.(checked ? "0.0.0.0" : "127.0.0.1")}
                    />
                    <span className="typography-meta text-muted-foreground">
                      {t("settings.remoteInstances.page.field.remoteLanAccessHint")}
                    </span>
                  </div>
                </div>
              </>
            )}

            {/* Release URL — managed mode, download_release */}
            {remoteMode === "managed" && installMethod === "download_release" && (
              <div className={ROW_CLASSES}>
                <span className={LABEL_CLASSES}>Release URL</span>
                <Input
                  className="h-7 md:max-w-xl font-mono text-sm"
                  value={releaseDownloadUrl ?? ""}
                  onChange={(e) => onReleaseDownloadUrlChange?.(e.target.value)}
                  placeholder="https://github.com/.../release.tar.gz"
                />
              </div>
            )}
          </SubSection>
        </div>
      )}

      {/* Main Tunnel — desktop only */}
      {isDesktop && bindHost !== undefined && (
        <div className="mb-6 border-t border-[var(--surface-subtle)] pt-6">
          <SubSection title="Main Tunnel">
            {/* Bind Host */}
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>Bind Host</span>
              <Select value={bindHost} onValueChange={onBindHostChange!}>
                <SelectTrigger className="h-7 w-fit min-w-[140px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="127.0.0.1">127.0.0.1</SelectItem>
                  <SelectItem value="0.0.0.0">0.0.0.0</SelectItem>
                  <SelectItem value="localhost">localhost</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Local Port */}
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>Local Port</span>
              <NumberInput
                value={preferredLocalPort}
                onValueChange={onPreferredLocalPortChange!}
                min={1}
                max={65535}
                step={1}
                onClear={() => onPreferredLocalPortChange?.(undefined)}
                emptyLabel="Auto"
              />
            </div>
          </SubSection>
        </div>
      )}

      {/* Authentication */}
      <div className="border-t border-[var(--surface-subtle)] pt-6">
        <SubSection title="Authentication">
          {/* Auth Type selector */}
          <div className={ROW_CLASSES}>
            <span className={LABEL_CLASSES}>Auth Type</span>
            <Select value={authType} onValueChange={onAuthTypeChange}>
              <SelectTrigger className="h-7 w-fit min-w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">None</SelectItem>
                {isDesktop ? (
                  <>
                    <SelectItem value="ssh-key">SSH Key</SelectItem>
                    <SelectItem value="ssh-password">SSH Password</SelectItem>
                    <SelectItem value="openchamber-password">OpenChamber Password</SelectItem>
                  </>
                ) : (
                  <>
                    <SelectItem value="password">Password</SelectItem>
                    <SelectItem value="bearer">Bearer Token</SelectItem>
                  </>
                )}
              </SelectContent>
            </Select>
          </div>

          {/* Desktop: SSH Password */}
          {isDesktop && authType === "ssh-password" && (
            <>
              <div className={ROW_CLASSES}>
                <span className={LABEL_CLASSES}>SSH Password</span>
                <div className="flex items-center gap-2 w-full md:max-w-sm">
                  <Input
                    className="h-7 flex-1"
                    type="password"
                    value={sshPasswordValue ?? ""}
                    onChange={(e) => onSshPasswordValueChange?.(e.target.value)}
                    placeholder="Enter SSH password"
                  />
                </div>
              </div>
              <div className={ROW_CLASSES}>
                <span className={LABEL_CLASSES}>Store in config</span>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={sshPasswordEnabled ?? false}
                    onCheckedChange={onSshPasswordEnabledChange!}
                  />
                  <span className="typography-meta text-muted-foreground">
                    Plaintext <Icon name="error-warning" className="h-3.5 w-3.5 inline" />
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Desktop: OpenChamber UI Password */}
          {isDesktop && authType === "openchamber-password" && (
            <>
              <div className={ROW_CLASSES}>
                <span className={LABEL_CLASSES}>Password</span>
                <div className="flex items-center gap-2 w-full md:max-w-sm">
                  <Input
                    className="h-7 flex-1"
                    type="password"
                    value={uiPasswordValue ?? ""}
                    onChange={(e) => onUiPasswordValueChange?.(e.target.value)}
                    placeholder="Enter OpenChamber password"
                  />
                </div>
              </div>
              <div className={ROW_CLASSES}>
                <span className={LABEL_CLASSES}>Store in config</span>
                <div className="flex items-center gap-2">
                  <Switch
                    checked={uiPasswordEnabled ?? false}
                    onCheckedChange={onUiPasswordEnabledChange!}
                  />
                  <span className="typography-meta text-muted-foreground">
                    Plaintext <Icon name="error-warning" className="h-3.5 w-3.5 inline" />
                  </span>
                </div>
              </div>
            </>
          )}

          {/* Web: Password / Bearer value */}
          {!isDesktop && authType !== "none" && (
            <div className={ROW_CLASSES}>
              <span className={LABEL_CLASSES}>
                {authType === "password" ? "Password" : "Token"}
              </span>
              <Input
                className="h-7 md:max-w-sm"
                type="password"
                value={authValue}
                onChange={(e) => onAuthValueChange(e.target.value)}
                placeholder={
                  authType === "password" ? "Enter password" : "Enter bearer token"
                }
              />
            </div>
          )}
        </SubSection>
      </div>

      {/* Web: additional upstream headers */}
      {!isDesktop && onRequestHeaderEntriesChange ? (
        <div className="border-t border-[var(--surface-subtle)] pt-6">
          <SubSection
            title={t('settings.remoteInstances.page.section.requestHeaders')}
            description={t('settings.remoteInstances.page.section.requestHeadersDescription')}
          >
            <div className="space-y-2">
              {(requestHeaderEntries ?? []).map((entry, index) => (
                <div key={`header-${index}`} className="flex flex-col gap-1.5 md:flex-row md:items-center md:gap-2">
                  <Input
                    className="h-7 md:w-44 font-mono text-sm"
                    value={entry.key}
                    onChange={(e) => {
                      const next = [...(requestHeaderEntries ?? [])];
                      next[index] = { ...entry, key: e.target.value };
                      onRequestHeaderEntriesChange(next);
                    }}
                    placeholder={t('settings.remoteInstances.page.field.headerNamePlaceholder')}
                    data-bwignore="true"
                    data-1p-ignore="true"
                  />
                  <Input
                    className="h-7 flex-1 font-mono text-sm"
                    type="password"
                    value={entry.value}
                    onChange={(e) => {
                      const next = [...(requestHeaderEntries ?? [])];
                      next[index] = { ...entry, value: e.target.value };
                      onRequestHeaderEntriesChange(next);
                    }}
                    placeholder={t('settings.remoteInstances.page.field.headerValuePlaceholder')}
                    data-bwignore="true"
                    data-1p-ignore="true"
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="xs"
                    className="!font-normal"
                    onClick={() => {
                      onRequestHeaderEntriesChange(
                        (requestHeaderEntries ?? []).filter((_, i) => i !== index),
                      );
                    }}
                    aria-label={t('settings.remoteInstances.page.actions.removeHeader')}
                  >
                    <Icon name="delete-bin" className="h-3.5 w-3.5" />
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="xs"
                className="!font-normal"
                onClick={() => onRequestHeaderEntriesChange([...(requestHeaderEntries ?? []), { key: '', value: '' }])}
              >
                <Icon name="add" className="h-3.5 w-3.5" />
                {t('settings.remoteInstances.page.actions.addHeader')}
              </Button>
            </div>
          </SubSection>
        </div>
      ) : null}
    </div>
  );
}
