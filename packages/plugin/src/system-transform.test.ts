import { describe, expect, test } from "bun:test"

import { createSystemTransformHandler } from "./system-transform.js"

describe("createSystemTransformHandler", () => {
  test("does not advertise fallback image tools to a native multimodal model", async () => {
    const output = { system: [] as string[] }
    const transform = createSystemTransformHandler()

    await transform(
      {
        model: {
          capabilities: {
            input: { image: true },
          },
        },
      },
      output,
    )

    const system = output.system.join("\n")
    expect(system).not.toContain("analyze_image")
    expect(system).not.toContain("look_at")
    expect(system).not.toContain("save_image_analysis")
  })

  test("advertises fallback image tools to a text-only model", async () => {
    const output = { system: [] as string[] }
    const transform = createSystemTransformHandler()

    await transform(
      {
        model: {
          capabilities: {
            input: { image: false },
          },
        },
      },
      output,
    )

    const system = output.system.join("\n")
    expect(system).toContain("analyze_image")
    expect(system).toContain("look_at")
    expect(system).toContain("save_image_analysis")
  })
})
