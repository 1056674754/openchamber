import { create, type StoreApi } from "zustand"
import type { DirState, State } from "./types"
import { INITIAL_STATE, MAX_DIR_STORES, DIR_IDLE_TTL_MS } from "./types"
import { pickDirectoriesToEvict, canDisposeDirectory, hasPendingBlockingRequests } from "./eviction"
import { readDirCache, persistVcs, persistProjectMeta, persistIcon } from "./persist-cache"
import { normalizePath } from "@/lib/pathNormalization"
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry"

export type DirectoryStore = State & {
  /** Apply a partial state update */
  patch: (partial: Partial<State>) => void
  /** Replace state wholesale (used during bootstrap) */
  replace: (next: State) => void
}

function createDirectoryStore(directory: string, serverId: string): StoreApi<DirectoryStore> {
  // Restore cached metadata from localStorage (scoped by serverId + directory)
  const cached = readDirCache(directory, serverId)

  const store = create<DirectoryStore>()((set) => ({
    ...INITIAL_STATE,
    vcs: cached.vcs ?? INITIAL_STATE.vcs,
    projectMeta: cached.projectMeta ?? INITIAL_STATE.projectMeta,
    icon: cached.icon ?? INITIAL_STATE.icon,
    patch: (partial) => set(partial),
    replace: (next) => set(next),
  }))

  // Subscribe to persist metadata changes back to localStorage
  store.subscribe((state, prev) => {
    if (state.vcs !== prev.vcs) persistVcs(directory, state.vcs, serverId)
    if (state.projectMeta !== prev.projectMeta) persistProjectMeta(directory, state.projectMeta, serverId)
    if (state.icon !== prev.icon) persistIcon(directory, state.icon, serverId)
  })

  return store
}

export class ChildStoreManager {
  readonly serverId: string
  readonly children = new Map<string, StoreApi<DirectoryStore>>()
  private readonly lifecycle = new Map<string, DirState>()
  private readonly pins = new Map<string, number>()
  private readonly disposers = new Map<string, () => void>()
  private readonly registrySubscribers = new Set<() => void>()

  private onBootstrap?: (directory: string) => void
  private onDispose?: (directory: string) => void
  private isBooting?: (directory: string) => boolean
  private isLoadingSessions?: (directory: string) => boolean

  constructor(serverId: string = DEFAULT_SERVER_ID) {
    this.serverId = serverId || DEFAULT_SERVER_ID
  }

  private notifyRegistrySubscribers() {
    for (const subscriber of this.registrySubscribers) {
      subscriber()
    }
  }

  configure(callbacks: {
    onBootstrap?: (directory: string) => void
    onDispose?: (directory: string) => void
    isBooting?: (directory: string) => boolean
    isLoadingSessions?: (directory: string) => boolean
  }) {
    this.onBootstrap = callbacks.onBootstrap
    this.onDispose = callbacks.onDispose
    this.isBooting = callbacks.isBooting
    this.isLoadingSessions = callbacks.isLoadingSessions
  }

  mark(directory: string) {
    const canonicalDirectory = normalizePath(directory)
    if (!canonicalDirectory) return
    this.lifecycle.set(canonicalDirectory, { lastAccessAt: Date.now() })
    this.runEviction(canonicalDirectory)
  }

  pin(directory: string) {
    const canonicalDirectory = normalizePath(directory)
    if (!canonicalDirectory) return
    this.pins.set(canonicalDirectory, (this.pins.get(canonicalDirectory) ?? 0) + 1)
    this.mark(canonicalDirectory)
  }

  unpin(directory: string) {
    const canonicalDirectory = normalizePath(directory)
    if (!canonicalDirectory) return
    const next = (this.pins.get(canonicalDirectory) ?? 0) - 1
    if (next > 0) {
      this.pins.set(canonicalDirectory, next)
      return
    }
    this.pins.delete(canonicalDirectory)
    this.runEviction()
  }

  pinned(directory: string) {
    const canonicalDirectory = normalizePath(directory)
    return canonicalDirectory ? (this.pins.get(canonicalDirectory) ?? 0) > 0 : false
  }

  ensureChild(directory: string, options?: { bootstrap?: boolean }): StoreApi<DirectoryStore> {
    const canonicalDirectory = normalizePath(directory)
    if (!canonicalDirectory) throw new Error("No directory provided to ensureChild")

    let store = this.children.get(canonicalDirectory)
    if (!store) {
      store = createDirectoryStore(canonicalDirectory, this.serverId)
      this.children.set(canonicalDirectory, store)
      this.notifyRegistrySubscribers()
    }

    this.mark(canonicalDirectory)

    const shouldBootstrap = options?.bootstrap ?? true
    const status = store.getState().status
    if (shouldBootstrap && (status === "loading" || status === "partial")) {
      this.onBootstrap?.(canonicalDirectory)
    }

    return store
  }

  getChild(directory: string): StoreApi<DirectoryStore> | undefined {
    const canonicalDirectory = normalizePath(directory)
    return canonicalDirectory ? this.children.get(canonicalDirectory) : undefined
  }

  disposeDirectory(directory: string): boolean {
    const canonicalDirectory = normalizePath(directory)
    if (!canonicalDirectory) return false
    if (
      !canDisposeDirectory({
        directory: canonicalDirectory,
        hasStore: this.children.has(canonicalDirectory),
        pinned: this.pinned(canonicalDirectory),
        booting: this.isBooting?.(canonicalDirectory) ?? false,
        loadingSessions: this.isLoadingSessions?.(canonicalDirectory) ?? false,
        hasPendingBlockingRequests: this.hasPendingBlockingRequestsForDirectory(canonicalDirectory),
      })
    ) {
      return false
    }

    this.lifecycle.delete(canonicalDirectory)
    this.children.delete(canonicalDirectory)
    this.notifyRegistrySubscribers()
    const dispose = this.disposers.get(canonicalDirectory)
    if (dispose) {
      dispose()
      this.disposers.delete(canonicalDirectory)
    }
    this.onDispose?.(canonicalDirectory)
    return true
  }

  runEviction(skip?: string) {
    const stores = [...this.children.keys()]
    if (stores.length === 0) return
    const list = pickDirectoriesToEvict({
      stores,
      state: this.lifecycle,
      pins: new Set(stores.filter((d) => this.pinned(d))),
      max: MAX_DIR_STORES,
      ttl: DIR_IDLE_TTL_MS,
      now: Date.now(),
      hasPendingBlockingRequests: (dir) => this.hasPendingBlockingRequestsForDirectory(dir),
    }).filter((d) => d !== skip)
    for (const directory of list) {
      this.disposeDirectory(directory)
    }
  }

  hasPendingBlockingRequestsForDirectory(directory: string): boolean {
    return hasPendingBlockingRequests(this.getChild(directory)?.getState())
  }

  /** Apply a state mutation to a directory's store */
  update(directory: string, fn: (state: State) => Partial<State>) {
    const store = this.getChild(directory)
    if (!store) return
    const current = store.getState()
    const patch = fn(current)
    store.setState(patch)
  }

  /** Get current state of a directory store (snapshot) */
  getState(directory: string): State | undefined {
    return this.getChild(directory)?.getState()
  }

  disposeAll() {
    for (const directory of [...this.children.keys()]) {
      this.children.delete(directory)
    }
    this.notifyRegistrySubscribers()
    this.lifecycle.clear()
    this.pins.clear()
    this.disposers.clear()
  }

  subscribeRegistry(listener: () => void): () => void {
    this.registrySubscribers.add(listener)
    return () => {
      this.registrySubscribers.delete(listener)
    }
  }

  subscribeAll(listener: () => void): () => void {
    const storeUnsubscribers = new Map<string, () => void>()

    const syncStoreSubscriptions = () => {
      const activeDirectories = new Set(this.children.keys())

      for (const [directory, unsubscribe] of storeUnsubscribers.entries()) {
        if (activeDirectories.has(directory)) {
          continue
        }
        unsubscribe()
        storeUnsubscribers.delete(directory)
      }

      for (const [directory, store] of this.children.entries()) {
        if (storeUnsubscribers.has(directory)) {
          continue
        }
        storeUnsubscribers.set(directory, store.subscribe(listener))
      }
    }

    syncStoreSubscriptions()
    const unsubscribeRegistry = this.subscribeRegistry(() => {
      syncStoreSubscriptions()
      listener()
    })

    return () => {
      unsubscribeRegistry()
      for (const unsubscribe of storeUnsubscribers.values()) {
        unsubscribe()
      }
      storeUnsubscribers.clear()
    }
  }
}
