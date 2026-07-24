import { describe, expect, test } from "bun:test"

import {
  createOpenChamberPluginRuntimeStatus,
  OPENCHAMBER_PLUGIN_ID,
  OPENCHAMBER_PLUGIN_RUNTIME_FEATURES,
  OPENCHAMBER_PLUGIN_RUNTIME_TOOLS,
  resolveOpenChamberPluginStatusFile,
} from "./runtime-status.js"

describe("createOpenChamberPluginRuntimeStatus", () => {
  test("stores runtime status inside an explicit OpenChamber data directory", () => {
    expect(resolveOpenChamberPluginStatusFile(
      { OPENCHAMBER_DATA_DIR: "/tmp/openchamber-isolated" },
      "/Users/test",
    )).toBe("/tmp/openchamber-isolated/plugin/status.json")
  })

  test("records the plugin features that the web runtime verifies", () => {
    const status = createOpenChamberPluginRuntimeStatus(new Date("2026-06-19T00:00:00.000Z"))

    expect(status).toMatchObject({
      id: OPENCHAMBER_PLUGIN_ID,
      loadedAt: "2026-06-19T00:00:00.000Z",
      features: OPENCHAMBER_PLUGIN_RUNTIME_FEATURES,
      tools: OPENCHAMBER_PLUGIN_RUNTIME_TOOLS,
    })
    expect(status.features.liveSteer).toBe(true)
    expect(status.features.imageFallback).toBe(true)
  })
})
