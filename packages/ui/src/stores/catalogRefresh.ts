/**
 * Re-reads the Settings-facing lists after OpenCode rebuilt a catalog
 * (OC2 spine S6; fork port of upstream `654705f7d` `stores/catalogRefresh.ts`).
 *
 * OpenCode v2 watches its own config files and announces what it rebuilt
 * (`agent.updated`, `provider.updated`, ...). The wire bridge folds those into
 * the fork-adjacent `catalog.updated` carrier, sync-context calls this module,
 * and the stores the Settings pages and the composer read re-list. The v1
 * track keeps its existing config-change flow; these events only exist on a
 * v2 stream.
 *
 * Every refresh is best-effort: a failed list leaves the previous one in place
 * and the next event or a page visit re-reads it.
 */

import type { CatalogBridgeKind } from "@/lib/opencode/wire-bridge"
import { invalidateAgentsLoadCache, useAgentsStore } from "@/stores/useAgentsStore"
import { invalidateCommandsLoadCache, useCommandsStore } from "@/stores/useCommandsStore"
import { invalidateSkillsLoadCache, useSkillsStore } from "@/stores/useSkillsStore"
import { useSkillsCatalogStore } from "@/stores/useSkillsCatalogStore"
import { useConfigStore } from "@/stores/useConfigStore"
import { useMcpConfigStore } from "@/stores/useMcpConfigStore"
import { usePluginsStore } from "@/stores/usePluginsStore"

const SOURCE = "catalogRefresh"

const refreshAgents = async (): Promise<void> => {
  invalidateAgentsLoadCache()
  await Promise.allSettled([
    useAgentsStore.getState().loadAgents(),
    useConfigStore.getState().loadAgents({ source: SOURCE }),
  ])
}

const refreshCommands = async (): Promise<void> => {
  invalidateCommandsLoadCache()
  await useCommandsStore.getState().loadCommands()
}

const refreshSkills = async (): Promise<void> => {
  invalidateSkillsLoadCache()
  await Promise.allSettled([
    useSkillsStore.getState().loadSkills(),
    useSkillsCatalogStore.getState().loadCatalog({ refresh: true }),
  ])
}

const refreshMcp = async (): Promise<void> => {
  await useMcpConfigStore.getState().loadMcpConfigs({ force: true })
}

const refreshPlugins = async (): Promise<void> => {
  await usePluginsStore.getState().loadPlugins({ force: true })
}

// The current list stays on screen until the fresh one lands: emptying it
// first would blank the composer's model and effort pickers and every message
// footer's effort label for the length of the request. `loadProviders` always
// re-reads (its only short-circuit is an in-flight request for the same
// directory) and keeps the existing objects when nothing changed.
const refreshProviders = async (): Promise<void> => {
  const config = useConfigStore.getState()
  config.invalidateModelMetadataCache()
  await config.loadProviders({ source: SOURCE })
}

/**
 * How long after a credential change the model list is read a second time.
 *
 * 2.0.8's `model.updated` only fires when OpenCode's own provider snapshot
 * changes, which it recomputes from integration and credential events. A
 * provider plugin that fetches its models from the provider after a login
 * (Copilot, LM Studio) lands later and announces nothing, so the first read
 * right after `credential.updated` can still land before those models exist.
 */
const PROVIDER_REREAD_AFTER_CREDENTIAL_MS = 5000

const refreshProvidersAfterCredentialChange = async (): Promise<void> => {
  await refreshProviders()
  await new Promise((resolve) => setTimeout(resolve, PROVIDER_REREAD_AFTER_CREDENTIAL_MS))
  await refreshProviders()
}

/** The lists a catalog kind invalidates, in the order they are re-read. */
export function catalogRefreshTasks(kind: CatalogBridgeKind): Array<() => Promise<void>> {
  switch (kind) {
    case "agent":
      return [refreshAgents]
    case "command":
      return [refreshCommands]
    case "skill":
      return [refreshSkills]
    case "plugin":
      return [refreshPlugins]
    // `provider.updated` and `model.updated` (2.0.8) are OpenCode's own
    // deduplicated announcements that the provider list, or the model list it
    // materialises, changed. Both are answered by re-reading the provider list,
    // which is where the composer's models come from.
    case "provider":
    case "model":
      return [refreshProviders]
    case "credential":
      return [refreshProvidersAfterCredentialChange]
    // A config file can carry any of them (a provider declared in
    // opencode.json included), and OpenChamber's own plugin injection lives
    // in one, so the whole set is re-read.
    case "config":
      return [refreshAgents, refreshCommands, refreshSkills, refreshMcp, refreshPlugins, refreshProviders]
    // Projects are the sync layer's own slice; nothing in Settings reads them
    // through these stores.
    case "project":
      return []
  }
}

export async function refreshStoresForCatalogKind(kind: CatalogBridgeKind): Promise<void> {
  const tasks = catalogRefreshTasks(kind)
  if (tasks.length === 0) return
  await Promise.allSettled(tasks.map((task) => task()))
}
