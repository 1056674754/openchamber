export class KeyedSingleFlight<Key, Value> {
  private readonly inflight = new Map<Key, Promise<Value>>()

  has(key: Key): boolean {
    return this.inflight.has(key)
  }

  run(key: Key, operation: () => Promise<Value>): Promise<Value> {
    const existing = this.inflight.get(key)
    if (existing) return existing

    let operationPromise: Promise<Value>
    try {
      operationPromise = operation()
    } catch (error) {
      return Promise.reject(error)
    }

    const tracked = operationPromise.then(
      (value) => {
        if (this.inflight.get(key) === tracked) this.inflight.delete(key)
        return value
      },
      (error: unknown) => {
        if (this.inflight.get(key) === tracked) this.inflight.delete(key)
        throw error
      },
    )
    this.inflight.set(key, tracked)
    return tracked
  }
}
