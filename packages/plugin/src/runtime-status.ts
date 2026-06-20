import { mkdirSync, renameSync, writeFileSync } from "node:fs"
import { homedir } from "node:os"
import { resolve } from "node:path"

export const OPENCHAMBER_PLUGIN_ID = "@openchamber/plugin"
export const OPENCHAMBER_PLUGIN_RUNTIME_STATUS_VERSION = 1

export const OPENCHAMBER_PLUGIN_RUNTIME_FEATURES = {
  imageFallback: true,
  liveSteer: true,
} as const

export const OPENCHAMBER_PLUGIN_RUNTIME_TOOLS = [
  "describe_image",
  "search_images",
  "save_image_analysis",
] as const

export type OpenChamberPluginRuntimeStatus = {
  readonly id: typeof OPENCHAMBER_PLUGIN_ID
  readonly version: typeof OPENCHAMBER_PLUGIN_RUNTIME_STATUS_VERSION
  readonly loadedAt: string
  readonly pid?: number
  readonly features: typeof OPENCHAMBER_PLUGIN_RUNTIME_FEATURES
  readonly tools: typeof OPENCHAMBER_PLUGIN_RUNTIME_TOOLS
}

const OPENCHAMBER_PLUGIN_STATUS_DIR = resolve(homedir(), ".config", "openchamber", "plugin")
export const OPENCHAMBER_PLUGIN_STATUS_FILE = resolve(OPENCHAMBER_PLUGIN_STATUS_DIR, "status.json")

export function createOpenChamberPluginRuntimeStatus(now = new Date()): OpenChamberPluginRuntimeStatus {
  const pid = typeof process === "object" && typeof process.pid === "number" ? process.pid : undefined
  return {
    id: OPENCHAMBER_PLUGIN_ID,
    version: OPENCHAMBER_PLUGIN_RUNTIME_STATUS_VERSION,
    loadedAt: now.toISOString(),
    ...(pid === undefined ? {} : { pid }),
    features: OPENCHAMBER_PLUGIN_RUNTIME_FEATURES,
    tools: OPENCHAMBER_PLUGIN_RUNTIME_TOOLS,
  }
}

export function writeOpenChamberPluginRuntimeStatus(): void {
  mkdirSync(OPENCHAMBER_PLUGIN_STATUS_DIR, { recursive: true })
  const tmpFile = `${OPENCHAMBER_PLUGIN_STATUS_FILE}.${Date.now()}.tmp`
  writeFileSync(
    tmpFile,
    `${JSON.stringify(createOpenChamberPluginRuntimeStatus(), null, 2)}\n`,
    "utf8",
  )
  renameSync(tmpFile, OPENCHAMBER_PLUGIN_STATUS_FILE)
}
