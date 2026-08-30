/**
 * Shared types for Remote Instances card components.
 */

import type { IconName } from "@/components/icon/icons";
import type { DesktopSshInstance, DesktopSshPortForward, DesktopSshPhase } from "@/lib/desktopSsh";
import type { RemoteInstance, RemoteInstancePhase } from "@/lib/remote-instances/types";

export type { DesktopSshPortForward };

// ─── KPI Tile ────────────────────────────────────────────────

export interface KpiTileProps {
  icon: IconName;
  label: string;
  value: string;
  variant: "success" | "error" | "warning" | "muted" | "info";
  animate?: boolean;
}

// ─── Phase Checklist ─────────────────────────────────────────

export interface PhaseStep {
  key: string;
  label: string;
  completed: boolean;
  current: boolean;
}

export interface PhaseChecklistProps {
  steps: PhaseStep[];
  connecting: boolean;
}

// ─── Shared Card Props (Desktop) ──────────────────────────────

export interface DesktopInstanceCardProps {
  instance: DesktopSshInstance;
}

// ─── Shared Card Props (Web) ─────────────────────────────────

export interface WebInstanceCardProps {
  instance: RemoteInstance;
  phase?: RemoteInstancePhase;
  url?: string;
  healthy?: boolean;
  latencyMs?: number;
}

// ─── Status Card ─────────────────────────────────────────────

export interface StatusCardProps {
  phase: DesktopSshPhase | RemoteInstancePhase | undefined;
  isReady: boolean;
  isConnecting: boolean;
  isError: boolean;
  isReconnecting: boolean;
  isRestarting: boolean;
  isDegraded: boolean;
  statusLabel: string;
  statusDetail?: string;
  localUrl?: string;
  latencyMs?: number;
  uptimeMs: number;
  remoteServiceUnavailable: boolean;
  reconnectAppearsStuck: boolean;
  phaseSteps: PhaseStep[];
  onCopyEndpoint: () => void;
  onOpenEndpoint: () => void;
  isDesktop: boolean;
}

// ─── Connection Card ─────────────────────────────────────────

export interface ConnectionCardProps {
  isReady: boolean;
  isConnecting: boolean;
  isReconnecting: boolean;
  isError: boolean;
  isRestarting: boolean;
  isDegraded: boolean;
  isIdle: boolean;
  reconnectAppearsStuck: boolean;
  canDisconnect: boolean;
  canRetry: boolean;
  isPrimaryActionPending: boolean;
  isRetryPending: boolean;
  isRestartPending: boolean;
  isTesting: boolean;
  primaryButtonLabel: string;
  retryButtonLabel: string;
  logDialogOpen: boolean;
  onConnect: () => void;
  onDisconnect: () => void;
  onRetry: () => void;
  onRestart: () => void;
  onTestConnection: () => void;
  onOpenLogs: () => void;
  onCloseLogs: () => void;
  isDesktop: boolean;
}

// ─── Log Panel ───────────────────────────────────────────────

export interface LogPanelProps {
  open: boolean;
  loading: boolean;
  error: string | null;
  lines: string[];
  onCopyAll: () => void;
  onClear: () => void;
}

// ─── Config Card ─────────────────────────────────────────────

export interface ConfigCardProps {
  // Desktop SSH fields
  isDesktop: boolean;
  sshCommand: string;
  onSshCommandChange: (value: string) => void;
  nickname: string;
  onNicknameChange: (value: string) => void;
  connectionTimeoutSec: number;
  onConnectionTimeoutChange: (value: number) => void;
  enabled: boolean;
  onEnabledChange: (value: boolean) => void;

  // Remote Server (desktop only)
  remoteMode?: "managed" | "external";
  onRemoteModeChange?: (value: "managed" | "external") => void;
  keepRunning?: boolean;
  onKeepRunningChange?: (value: boolean) => void;
  preferredRemotePort?: number;
  onPreferredRemotePortChange?: (value: number | undefined) => void;
  installMethod?: string;
  onInstallMethodChange?: (value: string) => void;
  releaseDownloadUrl?: string;
  onReleaseDownloadUrlChange?: (value: string) => void;
  remoteBindHost?: "127.0.0.1" | "0.0.0.0";
  onRemoteBindHostChange?: (value: "127.0.0.1" | "0.0.0.0") => void;

  // Main Tunnel (desktop only)
  bindHost?: string;
  onBindHostChange?: (value: string) => void;
  preferredLocalPort?: number;
  onPreferredLocalPortChange?: (value: number | undefined) => void;

  // Auth
  authType: string;
  onAuthTypeChange: (value: string) => void;
  authValue: string;
  onAuthValueChange: (value: string) => void;
  sshPasswordEnabled?: boolean;
  onSshPasswordEnabledChange?: (value: boolean) => void;
  sshPasswordValue?: string;
  onSshPasswordValueChange?: (value: string) => void;
  uiPasswordEnabled?: boolean;
  onUiPasswordEnabledChange?: (value: boolean) => void;
  uiPasswordValue?: string;
  onUiPasswordValueChange?: (value: string) => void;

  // Web URL
  webUrl: string;
  onWebUrlChange: (value: string) => void;

  /** Web-only additional upstream headers (key/value rows). */
  requestHeaderEntries?: Array<{ key: string; value: string }>;
  onRequestHeaderEntriesChange?: (entries: Array<{ key: string; value: string }>) => void;
}

// ─── Forward Card ────────────────────────────────────────────

export interface ForwardCardProps {
  forwards: DesktopSshPortForward[];
  expandedForwards: Record<string, boolean>;
  onToggleExpand: (id: string) => void;
  onUpdateForward: (id: string, updater: (forward: DesktopSshPortForward) => DesktopSshPortForward) => void;
  onRemoveForward: (id: string) => void;
  onAddForward: () => void;
  onOpenLocal: (forward: DesktopSshPortForward) => void;
  isDesktop: boolean;
}

// ─── Danger Card ─────────────────────────────────────────────

export interface DangerCardProps {
  onRemove: () => void;
  instanceLabel: string;
}

// ─── Import Card ─────────────────────────────────────────────

export interface ImportCandidate {
  host: string;
  pattern: boolean;
  source: string;
  sshCommand: string;
}

export interface ImportCardProps {
  loading: boolean;
  candidates: ImportCandidate[];
  patternHost: string | null;
  patternDestination: string;
  patternCreating: boolean;
  onImport: (host: string, pattern: boolean) => void;
  onPatternDestinationChange: (value: string) => void;
  onPatternCreate: () => void;
  onPatternClose: () => void;
  onQuickAdd: (sshCommand: string) => void;
}

// ─── Change Bar ──────────────────────────────────────────────

export interface ChangeBarProps {
  visible: boolean;
  changeCount: number;
  changeSummary: string;
  onSave: () => void;
  onDiscard: () => void;
  error: string | null;
  saving: boolean;
}
