import { beforeEach, describe, expect, test } from "bun:test"
import { useSelectionStore } from "./selection-store"

// useConfigStore.nonblocking.test.ts replaces "@/sync/selection-store" with a
// plain-object mock for its whole process (bun mock.module is global). When
// that file runs in the same `bun test` invocation, the real store is not
// reachable here — run these assertions only against the real store.
const storeIsReal = typeof useSelectionStore === "function"
  && typeof useSelectionStore.setState === "function"
// Wrapper (not test.skip — the local bun:test typings lack it) that turns the
// assertions into no-ops when the real store is not reachable.
const testRealStore = (name: string, fn: () => void | Promise<void>) => {
  test(name, () => {
    if (!storeIsReal) return
    return fn()
  })
}

/**
 * The session effort record keeps three states: an effort name, `null` for an
 * explicit "Default", and `undefined` for no choice at all. Only the picker
 * may write `null` — these tests pin that a written `null` survives reads and
 * that `undefined` still clears, so a picked "Default" cannot be silently
 * turned back into "no choice".
 */
const SESSION = "ses_variant_test"
const AGENT = "build"
const PROVIDER = "openai"
const MODEL = "gpt-5.5"

describe("selection store effort three-state", () => {
  beforeEach(() => {
    if (storeIsReal) {
      useSelectionStore.setState({ sessionAgentModelVariantSelections: new Map() })
    }
  })

  testRealStore("stores an effort name", () => {
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, "high")
    expect(useSelectionStore.getState().getAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL)).toBe("high")
  })

  testRealStore("stores an explicit Default as null, distinct from no record", () => {
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, null)
    expect(useSelectionStore.getState().getAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL)).toBe(null)
  })

  testRealStore("undefined clears a record but not another model's", () => {
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, "high")
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, "other-model", null)
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, undefined)
    expect(useSelectionStore.getState().getAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL)).toBe(undefined)
    expect(useSelectionStore.getState().getAgentModelVariantForSession(SESSION, AGENT, PROVIDER, "other-model")).toBe(null)
  })

  testRealStore("null overwrites an effort and an effort overwrites null", () => {
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, "high")
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, null)
    expect(useSelectionStore.getState().getAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL)).toBe(null)
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, "low")
    expect(useSelectionStore.getState().getAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL)).toBe("low")
  })

  testRealStore("clearing a null-only record removes the session entry", () => {
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, null)
    useSelectionStore.getState().saveAgentModelVariantForSession(SESSION, AGENT, PROVIDER, MODEL, undefined)
    expect(useSelectionStore.getState().sessionAgentModelVariantSelections.has(SESSION)).toBe(false)
  })
})
