/**
 * Selection Store — per-session model, agent, and variant selections.
 * Extracted from session-ui-store for subscription isolation.
 */

import { create } from "zustand"
import { persist } from "zustand/middleware"
import { createDeferredSafeJSONStorage } from "@/stores/utils/safeStorage"

type ModelSelection = { providerId: string; modelId: string }
type LastUsedProvider = { providerID: string; modelID: string }
type AgentModelSelectionEntries = [string, [string, ModelSelection][]][]
type AgentModelVariantEntries = [string, [string, [string, string][]][]][]
type PersistedSelectionState = {
  sessionModelSelections?: [string, ModelSelection][]
  sessionAgentSelections?: [string, string][]
  sessionAgentModelSelections?: AgentModelSelectionEntries
  sessionAgentModelVariantSelections?: AgentModelVariantEntries
  lastUsedProvider?: LastUsedProvider | null
}

export type SelectionState = {
  sessionModelSelections: Map<string, ModelSelection>
  sessionAgentSelections: Map<string, string>
  sessionAgentModelSelections: Map<string, Map<string, ModelSelection>>
  sessionAgentModelVariantSelections: Map<string, Map<string, Map<string, string>>>
  lastUsedProvider: LastUsedProvider | null

  saveSessionModelSelection: (sessionId: string, providerId: string, modelId: string) => void
  getSessionModelSelection: (sessionId: string) => { providerId: string; modelId: string } | null
  saveSessionAgentSelection: (sessionId: string, agentName: string) => void
  getSessionAgentSelection: (sessionId: string) => string | null
  saveAgentModelForSession: (sessionId: string, agentName: string, providerId: string, modelId: string) => void
  getAgentModelForSession: (sessionId: string, agentName: string) => { providerId: string; modelId: string } | null
  saveAgentModelVariantForSession: (sessionId: string, agentName: string, providerId: string, modelId: string, variant: string | undefined) => void
  getAgentModelVariantForSession: (sessionId: string, agentName: string, providerId: string, modelId: string) => string | undefined
}

const isPersistedSelectionState = (state: unknown): state is PersistedSelectionState => (
  typeof state === "object" && state !== null
)

// Maximum number of sessions to persist to local storage to prevent unbounded growth
const MAX_PERSISTED_SESSIONS = 150

export const useSelectionStore = create<SelectionState>()(
  persist(
    (set, get) => ({
      sessionModelSelections: new Map(),
      sessionAgentSelections: new Map(),
      sessionAgentModelSelections: new Map(),
      sessionAgentModelVariantSelections: new Map(),
      lastUsedProvider: null,

      saveSessionModelSelection: (sessionId, providerId, modelId) =>
        set((s) => {
          const map = new Map(s.sessionModelSelections)
          map.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          map.set(sessionId, { providerId, modelId })
          return { sessionModelSelections: map, lastUsedProvider: { providerID: providerId, modelID: modelId } }
        }),

      getSessionModelSelection: (sessionId) => get().sessionModelSelections.get(sessionId) ?? null,

      saveSessionAgentSelection: (sessionId, agentName) =>
        set((s) => {
          if (s.sessionAgentSelections.get(sessionId) === agentName) return s
          const map = new Map(s.sessionAgentSelections)
          map.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          map.set(sessionId, agentName)
          return { sessionAgentSelections: map }
        }),

      getSessionAgentSelection: (sessionId) => get().sessionAgentSelections.get(sessionId) ?? null,

      saveAgentModelForSession: (sessionId, agentName, providerId, modelId) =>
        set((s) => {
          const existing = s.sessionAgentModelSelections.get(sessionId)?.get(agentName)
          if (existing?.providerId === providerId && existing?.modelId === modelId) return s
          const outer = new Map(s.sessionAgentModelSelections)
          const inner = new Map(outer.get(sessionId) ?? new Map())

          outer.delete(sessionId) // Delete first to ensure it moves to the end of insertion order (MRU)
          inner.set(agentName, { providerId, modelId })
          outer.set(sessionId, inner)

          return { sessionAgentModelSelections: outer }
        }),

      getAgentModelForSession: (sessionId, agentName) =>
        get().sessionAgentModelSelections.get(sessionId)?.get(agentName) ?? null,

      saveAgentModelVariantForSession: (sessionId, agentName, providerId, modelId, variant) =>
        set((s) => {
          const key = `${providerId}/${modelId}`
          const outer = new Map(s.sessionAgentModelVariantSelections)
          let agentMap = outer.get(sessionId)
          if (!agentMap) {
            if (!variant) return s
            agentMap = new Map()
          } else {
            agentMap = new Map(agentMap)
          }

          let modelMap = agentMap.get(agentName)
          if (!modelMap) {
            if (!variant) {
              outer.set(sessionId, agentMap)
              return { sessionAgentModelVariantSelections: outer }
            }
            modelMap = new Map()
          } else {
            modelMap = new Map(modelMap)
          }

          if (!variant) {
            modelMap.delete(key)
          } else {
            modelMap.set(key, variant)
          }

          if (modelMap.size === 0) {
            agentMap.delete(agentName)
          } else {
            agentMap.set(agentName, modelMap)
          }

          if (agentMap.size === 0) {
            outer.delete(sessionId)
          } else {
            outer.set(sessionId, agentMap)
          }

          return { sessionAgentModelVariantSelections: outer }
        }),

      getAgentModelVariantForSession: (sessionId, agentName, providerId, modelId) => {
        const key = `${providerId}/${modelId}`
        return get().sessionAgentModelVariantSelections.get(sessionId)?.get(agentName)?.get(key)
      },
    }),
    {
      name: "selection-store",
      version: 2,
      storage: createDeferredSafeJSONStorage(),
      partialize: (state) => {
        // Convert Maps to arrays and slice to keep only the most recent MAX_PERSISTED_SESSIONS
        const models = Array.from(state.sessionModelSelections.entries()).slice(-MAX_PERSISTED_SESSIONS)
        const agents = Array.from(state.sessionAgentSelections.entries()).slice(-MAX_PERSISTED_SESSIONS)
        const agentModels = Array.from(state.sessionAgentModelSelections.entries())
          .slice(-MAX_PERSISTED_SESSIONS)
          .map(([sessionId, agentMap]) => [sessionId, Array.from(agentMap.entries())])
        const agentModelVariants = Array.from(state.sessionAgentModelVariantSelections.entries())
          .slice(-MAX_PERSISTED_SESSIONS)
          .map(([sessionId, agentMap]) => [
            sessionId,
            Array.from(agentMap.entries()).map(([agentName, modelMap]) => [
              agentName,
              Array.from(modelMap.entries()),
            ]),
          ])

        return {
          sessionModelSelections: models,
          sessionAgentSelections: agents,
          sessionAgentModelSelections: agentModels,
          sessionAgentModelVariantSelections: agentModelVariants,
          lastUsedProvider: state.lastUsedProvider,
        }
      },
      merge: (persistedState: unknown, currentState) => {
        const persisted = isPersistedSelectionState(persistedState) ? persistedState : undefined
        const agentModelSelections = new Map<string, Map<string, ModelSelection>>()
        if (Array.isArray(persisted?.sessionAgentModelSelections)) {
          persisted.sessionAgentModelSelections.forEach(([sessionId, agentArray]) => {
            agentModelSelections.set(sessionId, new Map(agentArray))
          })
        }

        const agentModelVariantSelections = new Map<string, Map<string, Map<string, string>>>()
        if (Array.isArray(persisted?.sessionAgentModelVariantSelections)) {
          persisted.sessionAgentModelVariantSelections.forEach(([sessionId, agentArray]) => {
            const agentMap = new Map<string, Map<string, string>>()
            agentArray.forEach(([agentName, modelArray]) => {
              agentMap.set(agentName, new Map(modelArray))
            })
            agentModelVariantSelections.set(sessionId, agentMap)
          })
        }

        return {
          ...currentState,
          lastUsedProvider: persisted?.lastUsedProvider ?? currentState.lastUsedProvider,
          sessionModelSelections: new Map(persisted?.sessionModelSelections ?? []),
          sessionAgentSelections: new Map(persisted?.sessionAgentSelections ?? []),
          sessionAgentModelSelections: agentModelSelections,
          sessionAgentModelVariantSelections: agentModelVariantSelections,
        }
      },
      migrate: (persistedState: unknown) => {
        // v2: sessionAgentModelVariantSelections promoted from in-memory to persisted.
        return persistedState
      }
    }
  )
)
