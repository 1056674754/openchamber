import { describe, expect, test } from "bun:test"

import { preserveCompleteHistoryCoverage, reconcileSyncMeta, type SyncMeta } from "../sync-meta"

const meta = (input: Partial<SyncMeta> = {}): SyncMeta => ({
  limit: 150,
  cursor: undefined,
  complete: false,
  loading: false,
  ...input,
})

describe("reconcileSyncMeta", () => {
  test("uses an equally complete prefetch cursor when local pagination metadata is stale", () => {
    expect(reconcileSyncMeta(
      meta(),
      meta({ cursor: "msg-older" }),
    )).toEqual(meta({ cursor: "msg-older" }))
  })

  test("does not replace wider local coverage with an older prefetch snapshot", () => {
    const local = meta({ limit: 300, cursor: "msg-local" })
    expect(reconcileSyncMeta(
      local,
      meta({ cursor: "msg-prefetch" }),
    )).toBe(local)
  })

  test("preserves an active local load while adopting newer pagination metadata", () => {
    expect(reconcileSyncMeta(
      meta({ loading: true }),
      meta({ limit: 300, cursor: "msg-older" }),
    )).toEqual(meta({ limit: 300, cursor: "msg-older", loading: true }))
  })

  test("does not weaken authoritative complete history with a tail cursor", () => {
    expect(preserveCompleteHistoryCoverage(
      { cursor: undefined, complete: true },
      { cursor: "stale-tail-cursor", complete: false },
    )).toEqual({ cursor: undefined, complete: true })
  })

  test("keeps complete local coverage when reconciling a wider stale prefetch", () => {
    expect(reconcileSyncMeta(
      meta({ complete: true }),
      meta({ limit: 300, cursor: "stale-tail-cursor", complete: false }),
    )).toEqual(meta({ limit: 300, complete: true }))
  })
})
