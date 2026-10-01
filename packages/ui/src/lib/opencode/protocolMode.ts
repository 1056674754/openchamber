// Fork dual-stack protocol-mode registry, UI side (spine plan §2).
//
// The web server is the authoritative probe point; it reports each server
// instance's mode (`v1 | v2`) over the existing bootstrap/config channel (S5/S8
// wiring), and this registry stores it per serverId. Default is `v1`: until the
// managed instance is deliberately flipped at activation, every consumer that
// finds nothing recorded keeps the exact v1 behavior.
//
// Consumption rule from the plan: UI code must not scatter `mode === 'v2'`
// checks through components. v2 branching is allowed only where the sync/SDK
// handle itself carries the mode (S5 `resolveSdkForDirectory`), with the S7
// dock-display mutex as the single documented exception.

export type ProtocolMode = "v1" | "v2";

export const PROTOCOL_MODES: readonly ProtocolMode[] = ["v1", "v2"];

/** Mirrors `DEFAULT_SERVER_ID` in server-registry: the managed instance. */
export const DEFAULT_PROTOCOL_MODE_SERVER_ID = "default";

export const DEFAULT_PROTOCOL_MODE: ProtocolMode = "v1";

const protocolModes = new Map<string, ProtocolMode>();

export function normalizeProtocolMode(value: unknown): ProtocolMode {
  return value === "v1" || value === "v2" ? value : DEFAULT_PROTOCOL_MODE;
}

export function setProtocolMode(serverId: string, mode: ProtocolMode): void {
  protocolModes.set(normalizeServerId(serverId), normalizeProtocolMode(mode));
}

export function getProtocolMode(serverId: string): ProtocolMode {
  return protocolModes.get(normalizeServerId(serverId)) ?? DEFAULT_PROTOCOL_MODE;
}

export function snapshotProtocolModes(): Record<string, ProtocolMode> {
  return Object.fromEntries(protocolModes.entries());
}

export function resetProtocolModes(): void {
  protocolModes.clear();
}

function normalizeServerId(serverId: string): string {
  const trimmed = typeof serverId === "string" ? serverId.trim() : "";
  return trimmed.length > 0 ? trimmed : DEFAULT_PROTOCOL_MODE_SERVER_ID;
}
