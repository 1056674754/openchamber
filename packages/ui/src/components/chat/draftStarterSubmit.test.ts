import { describe, expect, test } from "bun:test"
import { buildDraftStarterSubmitText } from "./draftStarterSubmit"

describe("draft starter submit text", () => {
  test("keeps command arguments on the invocation line", () => {
    expect(buildDraftStarterSubmitText("/review", "command", "src/components"))
      .toBe("/review src/components")
  })

  test("keeps skill prompts on following lines", () => {
    expect(buildDraftStarterSubmitText("/frontend", "skill", "Audit the page\nFix the layout"))
      .toBe("/frontend\nAudit the page\nFix the layout")
  })

  test("submits the starter unchanged when the draft is empty", () => {
    expect(buildDraftStarterSubmitText("/review", "command", "  "))
      .toBe("/review")
  })
})
