import type { Event } from "@opencode-ai/sdk/v2/client"

export type RemoteServerEvent = {
  serverId: string
  directory: string
  payload: Event
}

type RemoteServerEventListener = (event: RemoteServerEvent) => void

const listenersByServerId = new Map<string, Set<RemoteServerEventListener>>()

export function dispatchRemoteServerEvent(event: RemoteServerEvent): void {
  if (!event.serverId || !event.payload) {
    return
  }

  const listeners = listenersByServerId.get(event.serverId)
  if (!listeners || listeners.size === 0) {
    return
  }

  for (const listener of Array.from(listeners)) {
    listener(event)
  }
}

export function subscribeRemoteServerEvents(
  serverId: string,
  listener: RemoteServerEventListener,
): () => void {
  let listeners = listenersByServerId.get(serverId)
  if (!listeners) {
    listeners = new Set()
    listenersByServerId.set(serverId, listeners)
  }

  listeners.add(listener)
  return () => {
    listeners?.delete(listener)
    if (listeners?.size === 0) {
      listenersByServerId.delete(serverId)
    }
  }
}
