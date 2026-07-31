import { afterEach, describe, expect, test } from "bun:test"

import {
  observePinnedToasterStyles,
  observePinnedToastStyles,
} from "./sonnerPinnedStyles"

class FakeStyle {
  calls: Array<[string, string, string]> = []
  declarations = new Map<string, { value: string; priority: string }>()

  setProperty(name: string, value: string, priority: string) {
    this.calls.push([name, value, priority])
    this.declarations.set(name, { value, priority })
  }

  getPropertyValue(name: string) {
    return this.declarations.get(name)?.value ?? ""
  }

  getPropertyPriority(name: string) {
    return this.declarations.get(name)?.priority ?? ""
  }
}

class FakeElement {
  readonly style = new FakeStyle()
  readonly attributes = new Map<string, string>()
  queryCount = 0
  queryResults: FakeElement[] = []

  constructor(private readonly toast = false) {}

  matches(selector: string) {
    return selector === "[data-sonner-toast]" && this.toast
  }

  querySelectorAll(selector: string) {
    this.queryCount += 1
    return selector === "[data-sonner-toast]" ? this.queryResults : []
  }

  getAttribute(name: string) {
    return this.attributes.get(name) ?? null
  }

  setAttribute(name: string, value: string) {
    this.attributes.set(name, value)
  }
}

const originalHTMLElement = globalThis.HTMLElement
const originalMutationObserver = globalThis.MutationObserver

afterEach(() => {
  globalThis.HTMLElement = originalHTMLElement
  globalThis.MutationObserver = originalMutationObserver
})

describe("observePinnedToastStyles", () => {
  test("observes only the toaster and does not rescan it for attribute mutations", () => {
    const root = new FakeElement()
    const toast = new FakeElement(true)
    root.queryResults = [toast]

    let callback: MutationCallback = () => undefined
    let observedTarget: Node | null = null
    let observedOptions: MutationObserverInit | null = null

    class FakeMutationObserver {
      constructor(nextCallback: MutationCallback) {
        callback = nextCallback
      }

      observe(target: Node, options?: MutationObserverInit) {
        observedTarget = target
        observedOptions = options ?? null
      }

      disconnect() {}
      takeRecords(): MutationRecord[] {
        return []
      }
    }

    globalThis.HTMLElement = FakeElement as unknown as typeof HTMLElement
    globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver

    const cleanup = observePinnedToastStyles(
      root as unknown as HTMLElement,
      "test-shadow",
    )

    expect(observedTarget).toBe(root)
    expect(observedOptions).toEqual({
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ["style", "tabindex", "data-expanded", "data-swiping"],
    })
    expect(root.queryCount).toBe(1)

    const attributeMutation = {
      type: "attributes",
      target: toast,
      addedNodes: [],
    } as unknown as MutationRecord
    callback([attributeMutation], {} as MutationObserver)

    expect(root.queryCount).toBe(1)
    expect(toast.style.calls).toHaveLength(2)

    cleanup()
  })

  test("waits for a delayed toaster using child-list observation only", () => {
    const body = new FakeElement()
    const root = new FakeElement()
    let toaster: FakeElement | null = null
    const fakeDocument = {
      body,
      querySelector(selector: string) {
        return selector === "[data-sonner-toaster]" ? toaster : null
      },
    }

    const observers: Array<{
      callback: MutationCallback
      target: Node | null
      options: MutationObserverInit | null
      disconnected: boolean
    }> = []

    class FakeMutationObserver {
      private readonly record: (typeof observers)[number]

      constructor(callback: MutationCallback) {
        this.record = {
          callback,
          target: null,
          options: null,
          disconnected: false,
        }
        observers.push(this.record)
      }

      observe(target: Node, options?: MutationObserverInit) {
        this.record.target = target
        this.record.options = options ?? null
      }

      disconnect() {
        this.record.disconnected = true
      }

      takeRecords(): MutationRecord[] {
        return []
      }
    }

    globalThis.HTMLElement = FakeElement as unknown as typeof HTMLElement
    globalThis.MutationObserver = FakeMutationObserver as unknown as typeof MutationObserver

    const cleanup = observePinnedToasterStyles(
      fakeDocument as unknown as Document,
      "test-shadow",
    )

    expect(observers).toHaveLength(1)
    expect(observers[0]?.target).toBe(body)
    expect(observers[0]?.options).toEqual({
      childList: true,
      subtree: true,
    })

    toaster = root
    observers[0]?.callback(
      [{ type: "childList", addedNodes: [] }] as unknown as MutationRecord[],
      {} as MutationObserver,
    )

    expect(observers[0]?.disconnected).toBe(true)
    expect(observers).toHaveLength(2)
    expect(observers[1]?.target).toBe(root)

    cleanup()
    expect(observers[1]?.disconnected).toBe(true)
  })
})
