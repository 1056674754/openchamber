export type SinglePageHistoryPrefetch<T> = {
  prepare: (key: string, load: () => Promise<T>) => Promise<T>
  take: (key: string) => Promise<T> | undefined
}

export function createSinglePageHistoryPrefetch<T>(): SinglePageHistoryPrefetch<T> {
  let active: { key: string; request: Promise<T> } | undefined

  return {
    prepare: (key, load) => {
      if (active?.key === key) return active.request

      const request = load()
      active = { key, request }
      void request.catch(() => {
        if (active?.request === request) active = undefined
      })
      return request
    },
    take: (key) => {
      if (active?.key !== key) return undefined
      const request = active.request
      active = undefined
      return request
    },
  }
}
