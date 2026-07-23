type QueuedRemoteRead = {
  run: () => Promise<void>
}

type RemoteReadLane = {
  active: number
  interactiveQueue: QueuedRemoteRead[]
  backgroundQueue: QueuedRemoteRead[]
}

type RemoteReadScheduleOptions = {
  priority?: "interactive" | "background"
}

export type RemoteReadPressure = {
  active: number
  queued: number
}

export class RemoteReadQueueFullError extends Error {
  constructor(serverId: string, maxQueued: number) {
    super(`Remote read queue is full for ${serverId} (${maxQueued} queued)`)
    this.name = "RemoteReadQueueFullError"
  }
}

/**
 * Shared client-side admission control for idempotent remote reads.
 *
 * The web proxy admits four concurrent normal requests per remote instance.
 * Keeping reads at three leaves one slot for user-initiated mutations and
 * prevents discovery/reconnect work from filling the proxy's rejection queue.
 */
export class RemoteReadScheduler {
  private readonly lanes = new Map<string, RemoteReadLane>()

  constructor(
    private readonly maxActivePerServer = 3,
    private readonly maxQueuedPerServer = 512,
  ) {
    if (!Number.isInteger(maxActivePerServer) || maxActivePerServer < 1) {
      throw new Error("maxActivePerServer must be a positive integer")
    }
    if (!Number.isInteger(maxQueuedPerServer) || maxQueuedPerServer < 0) {
      throw new Error("maxQueuedPerServer must be a non-negative integer")
    }
  }

  schedule<T>(
    serverId: string,
    operation: () => Promise<T>,
    options: RemoteReadScheduleOptions = {},
  ): Promise<T> {
    const lane = this.getLane(serverId)
    const queued = lane.interactiveQueue.length + lane.backgroundQueue.length
    if (lane.active >= this.maxActivePerServer && queued >= this.maxQueuedPerServer) {
      return Promise.reject(new RemoteReadQueueFullError(serverId, this.maxQueuedPerServer))
    }

    return new Promise<T>((resolve, reject) => {
      const queue = options.priority === "background" ? lane.backgroundQueue : lane.interactiveQueue
      queue.push({
        run: async () => {
          try {
            resolve(await operation())
          } catch (error) {
            reject(error)
          }
        },
      })
      this.drain(serverId, lane)
    })
  }

  getPressure(serverId: string): RemoteReadPressure {
    const lane = this.lanes.get(serverId)
    return lane
      ? { active: lane.active, queued: lane.interactiveQueue.length + lane.backgroundQueue.length }
      : { active: 0, queued: 0 }
  }

  private getLane(serverId: string): RemoteReadLane {
    const existing = this.lanes.get(serverId)
    if (existing) return existing
    const lane: RemoteReadLane = { active: 0, interactiveQueue: [], backgroundQueue: [] }
    this.lanes.set(serverId, lane)
    return lane
  }

  private drain(serverId: string, lane: RemoteReadLane): void {
    while (lane.active < this.maxActivePerServer) {
      const job = lane.interactiveQueue.shift() ?? lane.backgroundQueue.shift()
      if (!job) break
      lane.active += 1
      void job.run().finally(() => {
        lane.active = Math.max(0, lane.active - 1)
        this.drain(serverId, lane)
        if (lane.active === 0 && lane.interactiveQueue.length === 0 && lane.backgroundQueue.length === 0) {
          this.lanes.delete(serverId)
        }
      })
    }
  }
}

export class KeyedRemoteReadCache<T> {
  private readonly inflight = new Map<string, Promise<T>>()

  constructor(private readonly scheduler: RemoteReadScheduler) {}

  schedule(
    serverId: string,
    resourceKey: string,
    operation: () => Promise<T>,
    options?: RemoteReadScheduleOptions,
  ): Promise<T> {
    const key = `${serverId}\n${resourceKey}`
    const existing = this.inflight.get(key)
    if (existing) return existing

    const promise = this.scheduler.schedule(serverId, operation, options)
    this.inflight.set(key, promise)
    const cleanup = () => {
      if (this.inflight.get(key) === promise) {
        this.inflight.delete(key)
      }
    }
    void promise.then(cleanup, cleanup)
    return promise
  }
}

export const sharedRemoteReadScheduler = new RemoteReadScheduler(3)
