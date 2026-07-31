import { describe, expect, test } from "bun:test"

import { ChildStoreManager } from "./child-store"

describe("ChildStoreManager.subscribeDirectory", () => {
  test("notifies only for the selected directory", () => {
    const stores = new ChildStoreManager()
    const selected = stores.ensureChild("/selected")
    const unrelated = stores.ensureChild("/unrelated")
    let notifications = 0
    const unsubscribe = stores.subscribeDirectory("/selected", () => {
      notifications += 1
    })

    unrelated.setState({ status: "complete" })
    expect(notifications).toBe(0)

    selected.setState({ status: "complete" })
    expect(notifications).toBe(1)
    unsubscribe()
  })
})
