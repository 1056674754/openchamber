import { describe, expect, test } from "bun:test"

import { parseSlashInvocation, resolveSlashRouteTarget } from "./slash-routing"

describe("slash routing", () => {
  test("parses command arguments without keeping the leading slash", () => {
    expect(parseSlashInvocation("/deploy production now")).toEqual({
      name: "deploy",
      arguments: "production now",
    })
  })

  test("routes skills from the same source used by autocomplete", () => {
    const target = resolveSlashRouteTarget("/lark-openapi-explorer check docs", [
      [],
      [],
      [{ name: "lark-openapi-explorer" }],
    ])

    expect(target).toEqual({
      name: "lark-openapi-explorer",
      arguments: "check docs",
    })
  })

  test("preserves canonical command or skill casing", () => {
    const target = resolveSlashRouteTarget("/Lark-OpenApi-Explorer", [
      [],
      [],
      [{ name: "lark-openapi-explorer" }],
    ])

    expect(target?.name).toBe("lark-openapi-explorer")
  })
})
