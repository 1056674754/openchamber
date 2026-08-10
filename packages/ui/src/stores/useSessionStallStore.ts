import { create } from "zustand"

export interface StallRecord {
  sessionId: string
  lastActivityAt: number
  detectedAt: number
  statusType: "busy" | "retry"
  statusAttempt?: number
  statusMessage?: string
}

interface SessionStallState {
  stalls: Map<string, StallRecord>
  markStalled: (record: StallRecord) => void
  clearStall: (sessionId: string) => void
  clearAllForSession: (sessionId: string) => void
}

export const useSessionStallStore = create<SessionStallState>((set) => ({
  stalls: new Map<string, StallRecord>(),

  markStalled: (record) => set((state) => {
    const existing = state.stalls.get(record.sessionId)
    if (existing && existing.detectedAt === record.detectedAt) return state
    const next = new Map(state.stalls)
    next.set(record.sessionId, record)
    return { stalls: next }
  }),

  clearStall: (sessionId) => set((state) => {
    if (!state.stalls.has(sessionId)) return state
    const next = new Map(state.stalls)
    next.delete(sessionId)
    return { stalls: next }
  }),

  clearAllForSession: (sessionId) => set((state) => {
    if (!state.stalls.has(sessionId)) return state
    const next = new Map(state.stalls)
    next.delete(sessionId)
    return { stalls: next }
  }),
}))

export function useSessionStall(sessionId: string | null | undefined): StallRecord | undefined {
  return useSessionStallStore((s) => (sessionId ? s.stalls.get(sessionId) : undefined))
}
