import { create } from "zustand";
import type { StoreApi, UseBoundStore } from "zustand";
import { devtools, persist } from "zustand/middleware";
import type { Config, Provider, Agent } from "@opencode-ai/sdk/v2";
import { AUTO_MODEL_ID, AUTO_PROVIDER_ID, isAutoModel } from '@/lib/routing/autoModel';
import { selectAutoReady, useRoutingStore } from '@/stores/useRoutingStore';
import { getOpencodeDirectory } from '@/lib/opencode/directoryBridge';
import { scopeMatches, subscribeToConfigChanges } from "@/lib/configSync";
import type { ModelMetadata } from "@/types";
import { createDeferredSafeJSONStorage } from "./utils/safeStorage";
import { filterVisibleAgents } from "./useAgentsStore";
import { useSessionUIStore } from "@/sync/session-ui-store";
import { useSelectionStore } from "@/sync/selection-store";
import { getRegisteredRuntimeAPIs } from "@/contexts/runtimeAPIRegistry";
import { updateDesktopSettings } from "@/lib/persistence";
import { useDirectoryStore } from "@/stores/useDirectoryStore";
import { streamDebugEnabled } from "@/stores/utils/streamDebug";
import { parseModelIdentifier } from "@/lib/modelIdentifier";
import { resolveApiUrl } from "@/lib/api/serverUrl";
import { normalizeConfigString, persistOpenChamberSettingsPatch, resolveConfiguredAgentName, type OpenChamberSettingsPatch } from "@/lib/configDefaults";
import { resolveProjectServerIdForDirectory, resolveApiUrl as resolveRemoteApiOrigin } from "@/sync/session-actions";
import { opencodeClient } from "@/lib/opencode/client";
import { DEFAULT_SERVER_ID, serverRegistry } from "@/lib/opencode/server-registry";
import { markStartupTrace, measureStartupTrace } from "@/lib/startupTrace";
import { normalizePath } from "@/lib/pathNormalization";
import { resolveModelVariant } from "@/lib/modelVariantResolution";
import { resolveSettingsProviderSelection, sanitizePersistedProviderSelection } from "./configProviderSelection";
import { getSyncConfig, subscribeToSyncConfigChanges } from "@/sync/sync-refs";

const MODELS_DEV_API_URL = "https://models.dev/api.json";
const MODELS_DEV_PROXY_URL = "/api/openchamber/models-metadata";
const STT_SILENCE_THRESHOLD_DB_MIN = -100;
const STT_SILENCE_THRESHOLD_DB_MAX = 0;
const STT_SILENCE_HOLD_MS_MIN = 250;
const STT_SILENCE_HOLD_MS_MAX = 10000;

const FALLBACK_PROVIDER_ID = "opencode";
const FALLBACK_MODEL_ID = "big-pickle";
const GIT_UTILITY_PROVIDER_ID = "zen";
const GIT_UTILITY_PREFERRED_MODEL_ID = "big-pickle";

const normalizeSttSilenceThresholdDb = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.max(STT_SILENCE_THRESHOLD_DB_MIN, Math.min(STT_SILENCE_THRESHOLD_DB_MAX, value));
};

const normalizeSttSilenceHoldMs = (value: unknown): number | undefined => {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        return undefined;
    }
    return Math.max(STT_SILENCE_HOLD_MS_MIN, Math.min(STT_SILENCE_HOLD_MS_MAX, Math.round(value)));
};

interface OpenChamberDefaults {
    defaultModel?: string;
    defaultVariant?: string;
    defaultAgent?: string;
    autoCreateWorktree?: boolean;
    gitmojiEnabled?: boolean;
    defaultFileViewerPreview?: boolean;
    zenModel?: string;
    messageStreamTransport?: 'auto' | 'ws' | 'sse';
    sttProvider?: 'browser' | 'server' | 'wasm';
    sttServerUrl?: string;
    wasmSttModel?: string;
    sttModel?: string;
    sttLanguage?: string;
    sttSilenceThresholdDb?: number;
    sttSilenceHoldMs?: number;
}

const fetchOpenChamberDefaults = async (serverBaseUrl?: string): Promise<OpenChamberDefaults> => {
    markStartupTrace('config.defaults:start', { scoped: Boolean(serverBaseUrl) });
    const started = typeof performance !== 'undefined' ? performance.now() : Date.now();
    const finish = (source: string, result: OpenChamberDefaults) => {
        const ended = typeof performance !== 'undefined' ? performance.now() : Date.now();
        markStartupTrace('config.defaults:end', {
            source,
            scoped: Boolean(serverBaseUrl),
            durationMs: Math.round(ended - started),
            hasDefaultModel: Boolean(result.defaultModel),
            hasDefaultAgent: Boolean(result.defaultAgent),
        });
        return result;
    };

    const buildFromApi = (data: Record<string, unknown> | null): Partial<OpenChamberDefaults> => {
        if (!data) return {};

        const defaultModel = normalizeConfigString(data?.defaultModel) ?? '';
        const defaultVariant = normalizeConfigString(data?.defaultVariant) ?? '';
        const defaultAgent = normalizeConfigString(data?.defaultAgent) ?? '';
        const gitmojiEnabled = typeof data?.gitmojiEnabled === 'boolean' ? data.gitmojiEnabled : undefined;
        const defaultFileViewerPreview = typeof data?.defaultFileViewerPreview === 'boolean' ? data.defaultFileViewerPreview : undefined;
        const zenModel = typeof data?.zenModel === 'string' ? data.zenModel.trim() : '';
        const messageStreamTransport =
            data?.messageStreamTransport === 'ws' || data?.messageStreamTransport === 'sse' || data?.messageStreamTransport === 'auto'
                ? data.messageStreamTransport
                : undefined;
        const sttProvider = data?.sttProvider === 'browser' || data?.sttProvider === 'server' || data?.sttProvider === 'wasm' ? data.sttProvider : undefined;
        const sttServerUrl = typeof data?.sttServerUrl === 'string' ? data.sttServerUrl.trim() : undefined;
        const sttModel = typeof data?.sttModel === 'string' ? data.sttModel.trim() : undefined;
        const sttLanguage = typeof data?.sttLanguage === 'string' ? data.sttLanguage.trim() : undefined;
        const sttSilenceThresholdDb = normalizeSttSilenceThresholdDb(data?.sttSilenceThresholdDb);
        const sttSilenceHoldMs = normalizeSttSilenceHoldMs(data?.sttSilenceHoldMs);

        return {
            defaultModel: defaultModel.length > 0 ? defaultModel : undefined,
            defaultVariant: defaultVariant.length > 0 ? defaultVariant : undefined,
            defaultAgent: defaultAgent.length > 0 ? defaultAgent : undefined,
            autoCreateWorktree: typeof data?.autoCreateWorktree === 'boolean' ? data.autoCreateWorktree : undefined,
            gitmojiEnabled,
            defaultFileViewerPreview,
            zenModel: zenModel.length > 0 ? zenModel : undefined,
            messageStreamTransport,
            sttProvider,
            sttServerUrl,
            sttModel,
            sttLanguage,
            sttSilenceThresholdDb,
            sttSilenceHoldMs,
        };
    };

    try {
        const runtimeSettings = serverBaseUrl ? null : getRegisteredRuntimeAPIs()?.settings;
        if (runtimeSettings) {
            try {
                const result = await runtimeSettings.load();
                const data = result?.settings;
                if (data) return finish('runtime-settings', buildFromApi(data) as OpenChamberDefaults);
            } catch {
                // ignore
            }
        }

        const response = await fetch(resolveApiUrl('/api/config/settings', serverBaseUrl), {
            method: 'GET',
            headers: { Accept: 'application/json' },
        });
        if (!response.ok) {
            return finish('settings-route-not-ok', {});
        }
        const apiData = response.ok ? await response.json() : null;
        return finish('settings-route', buildFromApi(apiData) as OpenChamberDefaults);
    } catch (error) {
        markStartupTrace('config.defaults:error', {
            scoped: Boolean(serverBaseUrl),
            error: error instanceof Error ? error.message : String(error),
        });
        return finish('error', {});
    }
};

const parseModelString = (modelString: string): { providerId: string; modelId: string } | null => {
    return parseModelIdentifier(modelString);
};

const normalizeProviderId = (value: string) => value?.toLowerCase?.() ?? '';

const isPrimaryMode = (mode?: string) => mode === "primary" || mode === "all" || mode === undefined || mode === null;

type ProviderModel = Provider["models"][string];
type ProviderWithModelList = Omit<Provider, "models"> & { models: ProviderModel[] };

type GitModelSelection = { providerId: string; modelId: string };

const normalizeOptionalString = (value: unknown): string | undefined => {
    return normalizeConfigString(value);
};

const hasProviderModel = (
    providers: ProviderWithModelList[],
    providerId: string,
    modelId: string
): boolean => {
    // Auto is not a provider OpenCode reports; it is a valid selection exactly
    // while the server says routing can honour it.
    if (isAutoModel(providerId, modelId)) {
        return selectAutoReady(useRoutingStore.getState());
    }
    const provider = providers.find((item) => item.id === providerId);
    if (!provider) {
        return false;
    }
    return provider.models.some((model) => model.id === modelId);
};

const hasValidVariant = (
    providers: ProviderWithModelList[],
    providerId: string,
    modelId: string,
    variant: string | undefined,
): boolean => {
    if (!variant) return true;
    const model = providers
        .find((provider) => provider.id === providerId)
        ?.models.find((entry) => entry.id === modelId) as { variants?: Record<string, unknown> } | undefined;
    return !!model?.variants && Object.prototype.hasOwnProperty.call(model.variants, variant);
};

const resolveSelectionWithManualGuard = ({
    agents,
    providers,
    currentAgentName,
    currentProviderId,
    currentModelId,
    currentVariant,
    selectionSource,
    resolvedAgentName,
    resolvedProviderId,
    resolvedModelId,
    resolvedVariant,
}: {
    agents: Agent[];
    providers: ProviderWithModelList[];
    currentAgentName: string | undefined;
    currentProviderId: string;
    currentModelId: string;
    currentVariant: string | undefined;
    selectionSource: "auto" | "manual";
    resolvedAgentName: string | undefined;
    resolvedProviderId: string | undefined;
    resolvedModelId: string | undefined;
    resolvedVariant: string | undefined;
}) => {
    const manualAgentName = currentAgentName && filterVisibleAgents(agents).some((agent) => agent.name === currentAgentName)
        ? currentAgentName
        : undefined;
    const manualModelValid = !!currentProviderId
        && !!currentModelId
        && hasProviderModel(providers, currentProviderId, currentModelId)
        && hasValidVariant(providers, currentProviderId, currentModelId, currentVariant);
    const preserveManual = selectionSource === "manual" && (!!manualAgentName || manualModelValid);

    return {
        agentName: preserveManual ? (manualAgentName ?? resolvedAgentName) : resolvedAgentName,
        providerId: preserveManual && manualModelValid ? currentProviderId : resolvedProviderId,
        modelId: preserveManual && manualModelValid ? currentModelId : resolvedModelId,
        variant: preserveManual && manualModelValid ? currentVariant : resolvedVariant,
        selectionSource: preserveManual ? "manual" as const : "auto" as const,
    };
};

type DefaultAgentModelSelection = {
    agentName: string | undefined;
    providerId?: string;
    modelId?: string;
    variant?: string;
};

/** Shared cascade: settings → opencode defaults → build/primary → fallbacks. */
const resolveDefaultAgentModelSelection = ({
    agents,
    providers,
    projectDefaultModel,
    projectDefaultVariant,
    settingsDefaultAgent,
    settingsDefaultModel,
    settingsDefaultVariant,
    opencodeDefaultAgent,
    opencodeDefaultModel,
}: {
    agents: Agent[];
    providers: ProviderWithModelList[];
    projectDefaultModel?: string;
    projectDefaultVariant?: string;
    settingsDefaultAgent?: string;
    settingsDefaultModel?: string;
    settingsDefaultVariant?: string;
    opencodeDefaultAgent?: string;
    opencodeDefaultModel?: string;
}): DefaultAgentModelSelection => {
    const visibleAgents = filterVisibleAgents(agents);
    if (visibleAgents.length === 0) {
        return { agentName: undefined };
    }

    const resolveVariant = (providerId: string, modelId: string, variant?: string): string | undefined => {
        if (!variant) return undefined;
        const model = providers
            .find((provider) => provider.id === providerId)
            ?.models.find((entry) => entry.id === modelId) as { variants?: Record<string, unknown> } | undefined;
        return model?.variants && Object.prototype.hasOwnProperty.call(model.variants, variant)
            ? variant
            : undefined;
    };

    const primaryAgents = visibleAgents.filter((agent) => isPrimaryMode(agent.mode));
    let resolvedAgent: Agent | undefined;
    if (settingsDefaultAgent) {
        resolvedAgent = visibleAgents.find((agent) => agent.name === settingsDefaultAgent);
    }
    if (!resolvedAgent && opencodeDefaultAgent) {
        const candidate = visibleAgents.find((agent) => agent.name === opencodeDefaultAgent);
        if (candidate && isPrimaryMode(candidate.mode)) {
            resolvedAgent = candidate;
        }
    }
    if (!resolvedAgent) {
        resolvedAgent = primaryAgents.find((agent) => agent.name === "build") || primaryAgents[0] || visibleAgents[0];
    }
    if (!resolvedAgent) {
        return { agentName: undefined };
    }

    let providerId: string | undefined;
    let modelId: string | undefined;
    let variant: string | undefined;

    const preferredModel = projectDefaultModel || settingsDefaultModel;
    if (preferredModel) {
        const parsed = parseModelString(preferredModel);
        if (parsed && hasProviderModel(providers, parsed.providerId, parsed.modelId)) {
            providerId = parsed.providerId;
            modelId = parsed.modelId;
            variant = resolveVariant(providerId, modelId, projectDefaultModel ? projectDefaultVariant : settingsDefaultVariant);
        }
    }

    if (!providerId
        && resolvedAgent.model?.providerID
        && resolvedAgent.model?.modelID
        && hasProviderModel(providers, resolvedAgent.model.providerID, resolvedAgent.model.modelID)) {
        providerId = resolvedAgent.model.providerID;
        modelId = resolvedAgent.model.modelID;
        variant = resolveVariant(providerId, modelId, resolvedAgent.variant);
    }

    if (!providerId && opencodeDefaultModel) {
        const parsed = parseModelString(opencodeDefaultModel);
        if (parsed && hasProviderModel(providers, parsed.providerId, parsed.modelId)) {
            providerId = parsed.providerId;
            modelId = parsed.modelId;
        }
    }

    if (!providerId) {
        if (hasProviderModel(providers, FALLBACK_PROVIDER_ID, FALLBACK_MODEL_ID)) {
            providerId = FALLBACK_PROVIDER_ID;
            modelId = FALLBACK_MODEL_ID;
        } else {
            const firstProvider = providers[0];
            const firstModel = firstProvider?.models[0];
            if (firstProvider && firstModel) {
                providerId = firstProvider.id;
                modelId = firstModel.id;
            }
        }
    }

    return {
        agentName: resolvedAgent.name,
        providerId,
        modelId,
        variant,
    };
};

const resolveGitGenerationModelSelection = ({
    providers,
    settingsZenModel,
}: {
    providers: ProviderWithModelList[];
    settingsZenModel?: string;
}): GitModelSelection | null => {
    const zenModel = normalizeOptionalString(settingsZenModel);

    if (!Array.isArray(providers) || providers.length === 0) {
        if (zenModel) {
            return { providerId: GIT_UTILITY_PROVIDER_ID, modelId: zenModel };
        }
        return null;
    }

    if (zenModel && hasProviderModel(providers, GIT_UTILITY_PROVIDER_ID, zenModel)) {
        return { providerId: GIT_UTILITY_PROVIDER_ID, modelId: zenModel };
    }

    if (hasProviderModel(providers, GIT_UTILITY_PROVIDER_ID, GIT_UTILITY_PREFERRED_MODEL_ID)) {
        return { providerId: GIT_UTILITY_PROVIDER_ID, modelId: GIT_UTILITY_PREFERRED_MODEL_ID };
    }

    const zenProvider = providers.find((provider) => provider.id === GIT_UTILITY_PROVIDER_ID);
    if (zenProvider?.models.length) {
        const randomIndex = Math.floor(Math.random() * zenProvider.models.length);
        const randomModelId = normalizeOptionalString(zenProvider.models[randomIndex]?.id);
        if (randomModelId) {
            return { providerId: GIT_UTILITY_PROVIDER_ID, modelId: randomModelId };
        }
    }

    return null;
};

interface ModelsDevModelEntry {
    id?: string;
    name?: string;
    tool_call?: boolean;
    reasoning?: boolean;
    temperature?: boolean;
    attachment?: boolean;
    modalities?: {
        input?: string[];
        output?: string[];
    };
    cost?: {
        input?: number;
        output?: number;
        cache_read?: number;
        cache_write?: number;
    };
    limit?: {
        context?: number;
        output?: number;
    };
    knowledge?: string;
    release_date?: string;
    last_updated?: string;
}

interface ModelsDevProviderEntry {
    id?: string;
    models?: Record<string, ModelsDevModelEntry | undefined>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    typeof value === "object" && value !== null;

const isStringArray = (value: unknown): value is string[] =>
    Array.isArray(value) && value.every((item) => typeof item === "string");

const isModelsDevModelEntry = (value: unknown): value is ModelsDevModelEntry => {
    if (!isRecord(value)) {
        return false;
    }
    const candidate = value as ModelsDevModelEntry;
    if (candidate.modalities) {
        const { input, output } = candidate.modalities;
        if (input && !isStringArray(input)) {
            return false;
        }
        if (output && !isStringArray(output)) {
            return false;
        }
    }
    return true;
};

const isModelsDevProviderEntry = (value: unknown): value is ModelsDevProviderEntry => {
    if (!isRecord(value)) {
        return false;
    }
    const candidate = value as ModelsDevProviderEntry;
    return candidate.models === undefined || isRecord(candidate.models);
};

const buildModelMetadataKey = (providerId: string, modelId: string) => {
    const normalizedProvider = normalizeProviderId(providerId);
    if (!normalizedProvider || !modelId) {
        return '';
    }
    return `${normalizedProvider}/${modelId}`;
};

const mapModalities = (cap: { text: boolean; audio: boolean; image: boolean; video: boolean; pdf: boolean } | undefined): string[] => {
    if (!cap) return [];
    const result: string[] = [];
    if (cap.text) result.push('text');
    if (cap.audio) result.push('audio');
    if (cap.image) result.push('image');
    if (cap.video) result.push('video');
    if (cap.pdf) result.push('pdf');
    return result;
};

const deriveModelMetadata = (providerId: string, model: ProviderModel): ModelMetadata => ({
    id: model.id,
    providerId,
    name: model.name,
    tool_call: model.capabilities?.toolcall,
    reasoning: model.capabilities?.reasoning,
    temperature: model.capabilities?.temperature,
    attachment: model.capabilities?.attachment,
    modalities: model.capabilities ? {
        input: mapModalities(model.capabilities.input),
        output: mapModalities(model.capabilities.output),
    } : undefined,
    cost: model.cost ? {
        input: model.cost.input,
        output: model.cost.output,
        cache_read: model.cost.cache?.read,
        cache_write: model.cost.cache?.write,
    } : undefined,
    limit: model.limit,
    release_date: model.release_date,
});

const transformModelsDevResponse = (payload: unknown): Map<string, ModelMetadata> => {
    const metadataMap = new Map<string, ModelMetadata>();

    if (!isRecord(payload)) {
        return metadataMap;
    }

    for (const [providerKey, providerValue] of Object.entries(payload)) {
        if (!isModelsDevProviderEntry(providerValue)) {
            continue;
        }

        const providerId = typeof providerValue.id === 'string' && providerValue.id.length > 0 ? providerValue.id : providerKey;
        const models = providerValue.models;
        if (!models || !isRecord(models)) {
            continue;
        }

        for (const [modelKey, modelValue] of Object.entries(models)) {
            if (!isModelsDevModelEntry(modelValue)) {
                continue;
            }

            const resolvedModelId =
                typeof modelKey === 'string' && modelKey.length > 0
                    ? modelKey
                    : modelValue.id;

            if (!resolvedModelId || typeof resolvedModelId !== 'string' || resolvedModelId.length === 0) {
                continue;
            }

            const metadata: ModelMetadata = {
                id: typeof modelValue.id === 'string' && modelValue.id.length > 0 ? modelValue.id : resolvedModelId,
                providerId,
                name: typeof modelValue.name === 'string' ? modelValue.name : undefined,
                tool_call: typeof modelValue.tool_call === 'boolean' ? modelValue.tool_call : undefined,
                reasoning: typeof modelValue.reasoning === 'boolean' ? modelValue.reasoning : undefined,
                temperature: typeof modelValue.temperature === 'boolean' ? modelValue.temperature : undefined,
                attachment: typeof modelValue.attachment === 'boolean' ? modelValue.attachment : undefined,
                modalities: modelValue.modalities
                    ? {
                          input: isStringArray(modelValue.modalities.input) ? modelValue.modalities.input : undefined,
                          output: isStringArray(modelValue.modalities.output) ? modelValue.modalities.output : undefined,
                      }
                    : undefined,
                cost: modelValue.cost,
                limit: modelValue.limit,
                knowledge: typeof modelValue.knowledge === 'string' ? modelValue.knowledge : undefined,
                release_date: typeof modelValue.release_date === 'string' ? modelValue.release_date : undefined,
                last_updated: typeof modelValue.last_updated === 'string' ? modelValue.last_updated : undefined,
            };

            const key = buildModelMetadataKey(providerId, resolvedModelId);
            if (key) {
                metadataMap.set(key, metadata);
            }
        }
    }

    return metadataMap;
};

const fetchModelsDevMetadata = async (): Promise<Map<string, ModelMetadata>> => {
    if (typeof fetch !== 'function') {
        return new Map();
    }

    const sources = [MODELS_DEV_PROXY_URL, MODELS_DEV_API_URL];

    for (const source of sources) {
        const controller = typeof AbortController !== 'undefined' ? new AbortController() : undefined;
        const timeout = controller ? setTimeout(() => controller.abort(), 8000) : undefined;

        try {
            const isAbsoluteUrl = /^https?:\/\//i.test(source);
            const requestInit: RequestInit = {
                signal: controller?.signal,
                headers: {
                    Accept: 'application/json',
                },
                cache: 'no-store',
            };

            if (isAbsoluteUrl) {
                requestInit.mode = 'cors';
            } else {
                requestInit.credentials = 'same-origin';
            }

            const response = await fetch(source, requestInit);

            if (!response.ok) {
                throw new Error(`Metadata request to ${source} returned status ${response.status}`);
            }

            const data = await response.json();
            return transformModelsDevResponse(data);
        } catch (error: unknown) {
            if ((error as Error)?.name === 'AbortError') {
                console.warn(`Model metadata request aborted (${source})`);
            } else {
                console.warn(`Failed to fetch model metadata from ${source}:`, error);
            }
        } finally {
            if (timeout) {
                clearTimeout(timeout);
            }
        }
    }

    return new Map();
};

let modelsMetadataInFlight: Promise<Map<string, ModelMetadata>> | null = null;

const ensureModelsMetadataFetch = (
    getModelsMetadata: () => Map<string, ModelMetadata>,
    setModelsMetadata: (metadata: Map<string, ModelMetadata>) => void,
) => {
    const existing = getModelsMetadata();
    if (existing.size > 0) {
        return;
    }

    if (modelsMetadataInFlight) {
        return;
    }

    markStartupTrace('modelsMetadata:queued');
    modelsMetadataInFlight = measureStartupTrace('modelsMetadata', fetchModelsDevMetadata)
        .then((metadata) => {
            if (metadata.size > 0) {
                markStartupTrace('modelsMetadata:set', { entries: metadata.size });
                setModelsMetadata(metadata);
            }
            return metadata;
        })
        .catch(() => new Map<string, ModelMetadata>())
        .finally(() => {
            modelsMetadataInFlight = null;
        });
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const CONNECTION_PROBE_TIMEOUT_MS = 800;

const probeOpenCodeHealth = async (timeoutMs = CONNECTION_PROBE_TIMEOUT_MS): Promise<boolean> => {
    const healthCheck = import('@/lib/opencode/client')
        .then(({ opencodeClient }) => opencodeClient.checkHealth());
    return Promise.race([
        healthCheck.catch(() => false),
        sleep(Math.max(1, timeoutMs)).then(() => false),
    ]);
};

const DIRECTORY_KEY_GLOBAL = "__global__";
const DIRECTORY_SCOPE_PREFIX = "__server__";
const DIRECTORY_SCOPE_SEPARATOR = "::";

const normalizeConfigServerId = (serverId: string | null | undefined): string => {
    const trimmed = typeof serverId === 'string' ? serverId.trim() : '';
    return trimmed.length > 0 ? trimmed : DEFAULT_SERVER_ID;
};

const toDirectoryKey = (directory: string | null | undefined, serverId?: string | null): string => {
    const directoryPart = normalizePath(directory) ?? DIRECTORY_KEY_GLOBAL;
    const normalizedServerId = normalizeConfigServerId(serverId);
    if (normalizedServerId === DEFAULT_SERVER_ID) {
        return directoryPart;
    }
    return `${DIRECTORY_SCOPE_PREFIX}${encodeURIComponent(normalizedServerId)}${DIRECTORY_SCOPE_SEPARATOR}${encodeURIComponent(directoryPart)}`;
};

const parseDirectoryKey = (key: string): { directory: string | null; serverId: string } => {
    if (!key.startsWith(DIRECTORY_SCOPE_PREFIX)) {
        return {
            directory: key === DIRECTORY_KEY_GLOBAL ? null : key,
            serverId: DEFAULT_SERVER_ID,
        };
    }

    const scopedKey = key.slice(DIRECTORY_SCOPE_PREFIX.length);
    const separatorIndex = scopedKey.indexOf(DIRECTORY_SCOPE_SEPARATOR);
    if (separatorIndex < 0) {
        return {
            directory: key === DIRECTORY_KEY_GLOBAL ? null : key,
            serverId: DEFAULT_SERVER_ID,
        };
    }

    const rawServerId = scopedKey.slice(0, separatorIndex);
    const rawDirectory = scopedKey.slice(separatorIndex + DIRECTORY_SCOPE_SEPARATOR.length);
    const directoryPart = normalizePath(decodeURIComponent(rawDirectory)) ?? DIRECTORY_KEY_GLOBAL;
    return {
        directory: directoryPart === DIRECTORY_KEY_GLOBAL ? null : directoryPart,
        serverId: normalizeConfigServerId(decodeURIComponent(rawServerId)),
    };
};

const fromDirectoryKey = (key: string): string | null => parseDirectoryKey(key).directory;
const serverIdFromDirectoryKey = (key: string): string => parseDirectoryKey(key).serverId;

const resolveConfigServerId = (
    directory: string | null | undefined,
    explicitServerId: string | null | undefined,
    activeDirectoryKey: string,
): string => {
    if (explicitServerId) {
        return normalizeConfigServerId(explicitServerId);
    }

    const activeScope = parseDirectoryKey(activeDirectoryKey);
    const normalizedDirectory = normalizePath(directory);
    if (activeScope.directory === normalizedDirectory) {
        return activeScope.serverId;
    }

    return DEFAULT_SERVER_ID;
};

const resolveConfigServerBaseUrl = (directory: string | null, serverId: string): string | undefined => {
    if (serverId !== DEFAULT_SERVER_ID) {
        return serverRegistry.get(serverId)?.config.baseUrl ?? (directory ? resolveRemoteApiOrigin(directory) : undefined);
    }
    return directory ? resolveRemoteApiOrigin(directory) : undefined;
};

const resolveInitialDirectoryKey = (): string => {
    if (typeof window === 'undefined') {
        return DIRECTORY_KEY_GLOBAL;
    }

    const directory = getOpencodeDirectory() ?? useDirectoryStore.getState().currentDirectory;
    return toDirectoryKey(directory);
};

interface DirectoryScopedConfig {

    providers: ProviderWithModelList[];
    agents: Agent[];
    currentProviderId: string;
    currentModelId: string;
    currentVariant?: string | undefined;
    currentAgentName: string | undefined;
    selectedProviderId: string;
    agentModelSelections: { [agentName: string]: { providerId: string; modelId: string } };
    defaultProviders: { [key: string]: string };
    opencodeDefaultAgent?: string;
    opencodeDefaultModel?: string;
    selectionSource?: "auto" | "manual";
}

const createEmptyDirectoryScopedConfig = (
    providers: ProviderWithModelList[] = [],
    agents: Agent[] = [],
): DirectoryScopedConfig => ({
    providers,
    agents,
    currentProviderId: "",
    currentModelId: "",
    currentVariant: undefined,
    currentAgentName: undefined,
    selectedProviderId: "",
    agentModelSelections: {},
    defaultProviders: {},
    opencodeDefaultAgent: undefined,
    opencodeDefaultModel: undefined,
    selectionSource: "auto",
});

type ConfigConnectionPhase = "connecting" | "connected" | "reconnecting";

export interface ConfigConnectionState {
    isConnected: boolean;
    hasEverConnected: boolean;
    connectionPhase: ConfigConnectionPhase;
    lastDisconnectReason: string | null;
}

interface ConfigStore {

    activeDirectoryKey: string;
    directoryScoped: Record<string, DirectoryScopedConfig>;

    providers: ProviderWithModelList[];
    agents: Agent[];
    currentProviderId: string;
    currentModelId: string;
    currentVariant: string | undefined;
    currentAgentName: string | undefined;
    selectedProviderId: string;
    agentModelSelections: { [agentName: string]: { providerId: string; modelId: string } };
    defaultProviders: { [key: string]: string };
    selectionSource: "auto" | "manual";
    isConnected: boolean;
    hasEverConnected: boolean;
    connectionPhase: ConfigConnectionPhase;
    lastDisconnectReason: string | null;
    connectionByServerId: Record<string, ConfigConnectionState>;
    isInitialized: boolean;
    modelsMetadata: Map<string, ModelMetadata>;
    // OpenChamber settings-based defaults (take precedence over agent preferences)
    settingsDefaultModel: string | undefined; // format: "provider/model"
    settingsDefaultVariant: string | undefined;
    settingsDefaultAgent: string | undefined;
    /** OpenCode server `default_agent` — applied only when settingsDefaultAgent is unset. */
    opencodeDefaultAgent: string | undefined;
    /** OpenCode server global `model` — applied only when settings/agent pin are unset. */
    opencodeDefaultModel: string | undefined;
    settingsAutoCreateWorktree: boolean;
    settingsGitmojiEnabled: boolean;
    settingsDefaultFileViewerPreview: boolean;
    settingsZenModel: string | undefined;
    settingsMessageStreamTransport: 'auto' | 'ws' | 'sse';
    // Voice provider preference ('browser', 'openai', 'openai-compatible', or 'say' for macOS)
    voiceProvider: 'browser' | 'openai' | 'openai-compatible' | 'say';
    setVoiceProvider: (provider: 'browser' | 'openai' | 'openai-compatible' | 'say') => void;
    // TTS settings
    speechRate: number;
    speechPitch: number;
    speechVolume: number;
    sayVoice: string;
    /** Local and macOS voices follow the language of the text being read. */
    ttsFollowTextLanguage: boolean;
    setTtsFollowTextLanguage: (enabled: boolean) => void;
    browserVoice: string;
    openaiVoice: string;
    openaiApiKey: string;
    openaiCompatibleUrl: string;
    openaiCompatibleApiKey: string;
    openaiCompatibleVoice: string;
    openaiCompatibleTtsModel: string;
    // STT (speech-to-text) settings
    sttProvider: 'browser' | 'server' | 'wasm';
    sttServerUrl: string;
    sttApiKey: string;
    sttModel: string;
    wasmSttModel: string;
    sttLanguage: string;
    sttSilenceThresholdDb: number;
    sttSilenceHoldMs: number;
    sttTranscribeOnStop: boolean;
    showMessageTTSButtons: boolean;
    ttsInputMode: 'sanitized' | 'raw';
    voiceModeEnabled: boolean;
    // Summarization settings
    summarizeMessageTTS: boolean;
    summarizeVoiceConversation: boolean;
    summarizeCharacterThreshold: number;
    summarizeMaxLength: number;
    setSpeechRate: (rate: number) => void;
    setSpeechPitch: (pitch: number) => void;
    setSpeechVolume: (volume: number) => void;
    setSayVoice: (voice: string) => void;
    setBrowserVoice: (voice: string) => void;
    setOpenaiVoice: (voice: string) => void;
    setOpenaiApiKey: (apiKey: string) => void;
    setOpenaiCompatibleUrl: (url: string) => void;
    setOpenaiCompatibleApiKey: (apiKey: string) => void;
    setOpenaiCompatibleVoice: (voice: string) => void;
    setOpenaiCompatibleTtsModel: (model: string) => void;
    setSttProvider: (provider: 'browser' | 'server' | 'wasm') => void;
    setSttServerUrl: (url: string) => void;
    setSttApiKey: (apiKey: string) => void;
    setSttModel: (model: string) => void;
    setWasmSttModel: (model: string) => void;
    setSttLanguage: (lang: string) => void;
    setSttSilenceThresholdDb: (db: number) => void;
    setSttSilenceHoldMs: (ms: number) => void;
    setSttTranscribeOnStop: (enabled: boolean) => void;
    setShowMessageTTSButtons: (show: boolean) => void;
    setTtsInputMode: (mode: 'sanitized' | 'raw') => void;
    setVoiceModeEnabled: (enabled: boolean) => void;
    setSummarizeMessageTTS: (enabled: boolean) => void;
    setSummarizeVoiceConversation: (enabled: boolean) => void;
    setSummarizeCharacterThreshold: (threshold: number) => void;
    setSummarizeMaxLength: (maxLength: number) => void;

    activateDirectory: (directory: string | null | undefined, options?: { serverId?: string | null }) => Promise<void>;

    loadProviders: (options?: { directory?: string | null; serverId?: string | null; source?: string }) => Promise<void>;
    loadAgents: (options?: { directory?: string | null; serverBaseUrl?: string; serverId?: string | null; source?: string }) => Promise<boolean>;
    invalidateModelMetadataCache: () => void;
    setProvider: (providerId: string) => void;
    setModel: (modelId: string) => void;
    setCurrentVariant: (variant: string | undefined) => void;
    cycleCurrentVariant: () => void;
    getCurrentModelVariants: () => string[];
    setAgent: (agentName: string | undefined) => void;
    /**
     * Re-apply draft defaults for the active directory snapshot.
     * Model cascade: project.defaultModel → settings.defaultModel → agent pin → fallback.
     */
    applyDefaultModelAgentSelection: (options?: { projectDefaultModel?: string; projectDefaultVariant?: string }) => void;
    applyOpenCodeConfigDefaults: (directory?: string | null, source?: string, config?: Config, serverId?: string | null) => void;
    setSelectedProvider: (providerId: string) => void;
    setSettingsDefaultModel: (model: string | undefined) => void;
    setSettingsDefaultVariant: (variant: string | undefined) => void;
    setSettingsDefaultAgent: (agent: string | undefined) => void;
    setSettingsAutoCreateWorktree: (enabled: boolean) => void;
    setSettingsGitmojiEnabled: (enabled: boolean) => void;
    setSettingsDefaultFileViewerPreview: (enabled: boolean) => void;
    setSettingsZenModel: (model: string | undefined) => void;
    setSettingsMessageStreamTransport: (transport: 'auto' | 'ws' | 'sse') => void;
    getResolvedGitGenerationModel: () => { providerId: string; modelId: string } | null;
    saveAgentModelSelection: (agentName: string, providerId: string, modelId: string) => void;
    getAgentModelSelection: (agentName: string) => { providerId: string; modelId: string } | null;
    probeConnection: (options?: { timeoutMs?: number }) => Promise<boolean>;
    checkConnection: () => Promise<boolean>;
    initializeApp: () => Promise<void>;
    getConnectionState: (serverId?: string | null) => ConfigConnectionState;
    setConnectionState: (serverId: string | null | undefined, patch: Partial<ConfigConnectionState>) => void;
    getCurrentProvider: () => ProviderWithModelList | undefined;
    getCurrentModel: () => ProviderModel | undefined;
    getCurrentAgent: () => Agent | undefined;
    getModelMetadata: (providerId: string, modelId: string) => ModelMetadata | undefined;
    // Returns only visible agents (excludes hidden internal agents like title, compaction, summary)
    getVisibleAgents: () => Agent[];
    getAgentsForDirectory: (directory?: string | null, serverId?: string | null) => Agent[];
}

declare global {
    interface Window {
        __zustand_config_store__?: UseBoundStore<StoreApi<ConfigStore>>;
    }
}

// In-flight dedup: prevent concurrent duplicate loadProviders/loadAgents calls for the same directory
const _inFlightProviders = new Map<string, Promise<void>>();
const _inFlightAgents = new Map<string, Promise<boolean>>();
let _initializeAppInFlight: Promise<void> | null = null;

const EMPTY_PROVIDERS: ProviderWithModelList[] = [];
export const selectProvidersForDirectory = (
    state: Pick<ConfigStore, "providers" | "directoryScoped" | "activeDirectoryKey">,
    directory?: string | null,
    serverId?: string | null,
): ProviderWithModelList[] => {
    const key = toDirectoryKey(directory, serverId);
    if (key === state.activeDirectoryKey) return state.providers;
    return state.directoryScoped[key]?.providers ?? EMPTY_PROVIDERS;
};

const disconnectedConnectionState: ConfigConnectionState = {
    isConnected: false,
    hasEverConnected: false,
    connectionPhase: "connecting",
    lastDisconnectReason: null,
};

const getConfigConnectionState = (
    state: Pick<ConfigStore, "isConnected" | "hasEverConnected" | "connectionPhase" | "lastDisconnectReason" | "connectionByServerId">,
    serverId?: string | null,
): ConfigConnectionState => {
    const normalizedServerId = normalizeConfigServerId(serverId);
    if (normalizedServerId === DEFAULT_SERVER_ID) {
        return {
            isConnected: state.isConnected,
            hasEverConnected: state.hasEverConnected,
            connectionPhase: state.connectionPhase,
            lastDisconnectReason: state.lastDisconnectReason,
        };
    }
    return state.connectionByServerId[normalizedServerId] ?? disconnectedConnectionState;
};

const connectionStatesEqual = (a: ConfigConnectionState, b: ConfigConnectionState): boolean =>
    a.isConnected === b.isConnected
    && a.hasEverConnected === b.hasEverConnected
    && a.connectionPhase === b.connectionPhase
    && a.lastDisconnectReason === b.lastDisconnectReason;

export const useConfigStore = create<ConfigStore>()(
    devtools(
        persist(
            (set, get) => ({

                activeDirectoryKey: resolveInitialDirectoryKey(),
                directoryScoped: {},

                providers: [],
                agents: [],
                currentProviderId: "",
                currentModelId: "",
                currentVariant: undefined,
                currentAgentName: undefined,
                selectedProviderId: "",
                agentModelSelections: {},
                defaultProviders: {},
                selectionSource: "auto",
                isConnected: false,
                hasEverConnected: false,
                connectionPhase: "connecting",
                lastDisconnectReason: null,
                connectionByServerId: {},
                isInitialized: false,
                modelsMetadata: new Map<string, ModelMetadata>(),
                settingsDefaultModel: undefined,
                settingsDefaultVariant: undefined,
                settingsDefaultAgent: undefined,
                opencodeDefaultAgent: undefined,
                opencodeDefaultModel: undefined,
                settingsAutoCreateWorktree: false,
                settingsGitmojiEnabled: false,
                // Artifacts an agent produces are opened to be looked at:
                // the preview comes first unless the user turns it off.
                settingsDefaultFileViewerPreview: true,
                settingsZenModel: undefined,
                settingsMessageStreamTransport: 'ws',
                // Voice provider preference - load from localStorage or default to 'browser'
                voiceProvider: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('voiceProvider');
                        if (saved === 'openai' || saved === 'browser' || saved === 'say' || saved === 'openai-compatible') return saved;
                    }
                    return 'browser';
                })(),
                // TTS settings - load from localStorage with defaults
                speechRate: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('speechRate');
                        if (saved) {
                            const parsed = parseFloat(saved);
                            if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 2) return parsed;
                        }
                    }
                    return 1;
                })(),
                speechPitch: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('speechPitch');
                        if (saved) {
                            const parsed = parseFloat(saved);
                            if (!isNaN(parsed) && parsed >= 0.5 && parsed <= 2) return parsed;
                        }
                    }
                    return 1;
                })(),
                speechVolume: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('speechVolume');
                        if (saved) {
                            const parsed = parseFloat(saved);
                            if (!isNaN(parsed) && parsed >= 0 && parsed <= 1) return parsed;
                        }
                    }
                    return 1;
                })(),
                // macOS Say voice - load from localStorage or default to 'Samantha'
                sayVoice: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sayVoice');
                        if (saved) return saved;
                    }
                    return 'Samantha';
                })(),
                // Voice follows the text's language - default on, like upstream
                ttsFollowTextLanguage: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('ttsFollowTextLanguage');
                        if (saved !== null) return saved === 'true';
                    }
                    return true;
                })(),
                // Browser voice - load from localStorage or default to empty (auto-select)
                browserVoice: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('browserVoice');
                        if (saved) return saved;
                    }
                    return '';
                })(),
                // OpenAI voice - load from localStorage or default to 'nova'
                openaiVoice: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('openaiVoice');
                        if (saved) return saved;
                    }
                    return 'nova';
                })(),
                // OpenAI API key for TTS - load from localStorage or default to empty
                openaiApiKey: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('openaiApiKey');
                        if (saved) return saved;
                    }
                    return '';
                })(),
                // OpenAI-compatible custom server URL
                openaiCompatibleUrl: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('openaiCompatibleUrl');
                        if (saved) return saved;
                    }
                    return '';
                })(),
                // OpenAI-compatible custom server API key
                openaiCompatibleApiKey: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('openaiCompatibleApiKey');
                        if (saved) return saved;
                    }
                    return '';
                })(),
                // OpenAI-compatible custom server voice
                openaiCompatibleVoice: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('openaiCompatibleVoice');
                        if (saved) return saved;
                    }
                    return 'af_sky';
                })(),
                // OpenAI-compatible custom server TTS model
                openaiCompatibleTtsModel: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('openaiCompatibleTtsModel');
                        if (saved && saved !== 'speaches-ai/Kokoro-82M-v1.0-ONNX') return saved;
                    }
                    return 'kokoro';
                })(),
                // STT provider: 'browser' (Web Speech API), 'server' (OpenAI-compat), 'wasm' (local Whisper)
                sttProvider: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sttProvider');
                        if (saved === 'browser' || saved === 'server' || saved === 'wasm') return saved;
                        // Electron/Chromium's Web Speech API requires Google API keys
                        // not available in Electron, so default to WASM local Whisper.
                        const electron = (window as unknown as { __OPENCHAMBER_ELECTRON__?: { runtime?: string } }).__OPENCHAMBER_ELECTRON__;
                        if (electron?.runtime === 'electron') return 'wasm' as const;
                    }
                    return 'browser' as const;
                })(),
                sttServerUrl: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sttServerUrl');
                        if (saved) return saved;
                    }
                    return 'http://localhost:8001/v1';
                })(),
                sttApiKey: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sttApiKey');
                        if (saved) return saved;
                    }
                    return '';
                })(),
                sttModel: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sttModel');
                        if (saved) return saved;
                    }
                    return 'deepdml/faster-whisper-large-v3-turbo-ct2';
                })(),
                wasmSttModel: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('wasmSttModel');
                        if (saved) return saved;
                    }
                    return 'Xenova/whisper-base.en';
                })(),
                sttLanguage: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sttLanguage');
                        if (saved !== null) return saved;
                    }
                    return '';
                })(),
                sttSilenceThresholdDb: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sttSilenceThresholdDb');
                        if (saved) {
                            const parsed = parseFloat(saved);
                            if (!isNaN(parsed)) return parsed;
                        }
                    }
                    return -45;
                })(),
                sttSilenceHoldMs: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sttSilenceHoldMs');
                        if (saved) {
                            const parsed = parseInt(saved, 10);
                            if (!isNaN(parsed)) return parsed;
                        }
                    }
                    return 1500;
                })(),
                sttTranscribeOnStop: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('sttTranscribeOnStop');
                        if (saved === 'true') return true;
                    }
                    return false;
                })(),
                // Show TTS buttons on messages - disabled by default until user enables it
                showMessageTTSButtons: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('showMessageTTSButtons');
                        if (saved === 'true') return true;
                    }
                    return false;
                })(),
                ttsInputMode: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('ttsInputMode');
                        if (saved === 'raw') return 'raw' as const;
                    }
                    return 'sanitized' as const;
                })(),
                // Voice mode enabled - load from localStorage or default to false
                voiceModeEnabled: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('voiceModeEnabled');
                        if (saved === 'true') return true;
                    }
                    return false;
                })(),
                // Summarization settings
                summarizeMessageTTS: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('summarizeMessageTTS');
                        if (saved === 'true') return true;
                    }
                    return false;
                })(),
                summarizeVoiceConversation: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('summarizeVoiceConversation');
                        if (saved === 'true') return true;
                    }
                    return false;
                })(),
                summarizeCharacterThreshold: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('summarizeCharacterThreshold');
                        if (saved) {
                            const parsed = parseInt(saved, 10);
                            if (!isNaN(parsed) && parsed >= 50 && parsed <= 2000) return parsed;
                        }
                    }
                    return 200;
                })(),
                summarizeMaxLength: (() => {
                    if (typeof window !== 'undefined') {
                        const saved = localStorage.getItem('summarizeMaxLength');
                        if (saved) {
                            const parsed = parseInt(saved, 10);
                            if (!isNaN(parsed) && parsed >= 50 && parsed <= 2000) return parsed;
                        }
                    }
                    return 500;
                })(),
                activateDirectory: async (directory, options) => {
                    const serverId = normalizeConfigServerId(options?.serverId);
                    const directoryKey = toDirectoryKey(directory, serverId);
                    let snapshotHadProviders = false;

                    set((state) => {
                        const snapshot = state.directoryScoped[directoryKey];
                        if (snapshot) {
                            snapshotHadProviders = snapshot.providers.length > 0;
                            return {
                                activeDirectoryKey: directoryKey,
                                providers: snapshot.providers,
                                agents: snapshot.agents,
                                currentProviderId: snapshot.currentProviderId,
                                currentModelId: snapshot.currentModelId,
                                currentVariant: snapshot.currentVariant,
                                currentAgentName: snapshot.currentAgentName,
                                selectedProviderId: snapshot.selectedProviderId,
                                agentModelSelections: snapshot.agentModelSelections,
                                defaultProviders: snapshot.defaultProviders,
                                opencodeDefaultAgent: snapshot.opencodeDefaultAgent,
                                opencodeDefaultModel: snapshot.opencodeDefaultModel,
                                selectionSource: snapshot.selectionSource ?? "auto",
                            };
                        }

                        return {
                            activeDirectoryKey: directoryKey,
                            providers: [],
                            agents: [],
                            currentProviderId: "",
                            currentModelId: "",
                            currentAgentName: undefined,
                            selectedProviderId: "",
                            agentModelSelections: {},
                            defaultProviders: {},
                            opencodeDefaultAgent: undefined,
                            opencodeDefaultModel: undefined,
                            selectionSource: "auto",
                        };
                    });

                    if (!get().getConnectionState(serverId).isConnected) {
                        return;
                    }

                    const dir = fromDirectoryKey(directoryKey)
                    const remoteBaseUrl = resolveConfigServerBaseUrl(dir, serverId)
                    if (snapshotHadProviders) {
                        markStartupTrace('activateDirectory:skipProviders', { directoryKey, serverId });
                    } else {
                        await get().loadProviders({ directory: dir, serverId, source: 'activateDirectory' });
                    }

                    // Persisted agents are only a fast first-paint cache. Plugin startup,
                    // project config, or an OpenCode restart can change the authoritative
                    // catalog while OpenChamber is closed, so every directory activation
                    // must reconcile it against the owning server.
                    await get().loadAgents({ directory: dir, serverBaseUrl: remoteBaseUrl, serverId, source: 'activateDirectory' });
                },

                loadProviders: async (options) => {
                    const targetDirectory = options?.directory ?? fromDirectoryKey(get().activeDirectoryKey);
                    const serverId = resolveConfigServerId(targetDirectory, options?.serverId, get().activeDirectoryKey);
                    const directoryKey = toDirectoryKey(targetDirectory, serverId);
                    const source = options?.source ?? 'unknown';
                    const effectiveDirectory = targetDirectory ?? getOpencodeDirectory();
                    markStartupTrace('loadProviders:called', { directoryKey, serverId, source, requestedDirectory: targetDirectory, effectiveDirectory });

                    // Dedup: if a load is already in-flight for this directory, reuse it
                    const existing = _inFlightProviders.get(directoryKey);
                    if (existing) {
                        markStartupTrace('loadProviders:deduped', { directoryKey, serverId, source, requestedDirectory: targetDirectory, effectiveDirectory });
                        return existing;
                    }

                    const promise = (async () => {
                    const loaderStarted = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    markStartupTrace('loadProviders:start', { directoryKey, serverId, source, requestedDirectory: targetDirectory, effectiveDirectory });
                    const existingSnapshot = get().directoryScoped[directoryKey];
                    const previousProviders = existingSnapshot?.providers ?? (get().activeDirectoryKey === directoryKey ? get().providers : []);
                    const previousDefaults = existingSnapshot?.defaultProviders ?? (get().activeDirectoryKey === directoryKey ? get().defaultProviders : {});
                    let lastError: unknown = null;

                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            ensureModelsMetadataFetch(
                                () => get().modelsMetadata,
                                (metadata) => set({ modelsMetadata: metadata }),
                            );
                            const targetDir = fromDirectoryKey(directoryKey)
                            // R2 client unification: provider catalog from the
                            // v2 provider/model/default trio; failures throw
                            // (retry loop below observes them).
                            const catalog = await measureStartupTrace(
                                'loadProviders:api',
                                () => opencodeClient.getProvidersForConfig(targetDir ?? undefined, { serverId, fresh: attempt > 0 }),
                                { directoryKey, serverId, source, requestedDirectory: targetDirectory, effectiveDirectory, attempt: attempt + 1 },
                            )
                            const providers = Array.isArray(catalog.providers) ? catalog.providers as unknown as Provider[] : [];
                            // v1's per-directory default map collapses to the
                            // single v2 default model ref.
                            const defaults: { [key: string]: string } = catalog.default
                                ? { [catalog.default.providerID]: catalog.default.id }
                                : {};

                            // v2 lists models on their own route, keyed by
                            // providerID — regroup them onto the provider
                            // records the store shape expects (R2 残留:
                            // sync-bridge batch retypes the store).
                            const modelsByProvider = new Map<string, ProviderModel[]>();
                            for (const model of catalog.models) {
                                const list = modelsByProvider.get(model.providerID) ?? [];
                                list.push(model as unknown as ProviderModel);
                                modelsByProvider.set(model.providerID, list);
                            }
                            const processedProviders: ProviderWithModelList[] = providers.map((provider) => ({
                                ...provider,
                                models: modelsByProvider.get(provider.id) ?? [],
                            }));

                            set((state) => {
                                const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                                    providers: [],
                                    agents: [],
                                    currentProviderId: "",
                                    currentModelId: "",
                                    currentAgentName: undefined,
                                    selectedProviderId: "",
                                    agentModelSelections: {},
                                    defaultProviders: {},
                                };
                                const configuredDefaultProviderId = state.settingsDefaultModel
                                    ? parseModelString(state.settingsDefaultModel)?.providerId
                                    : undefined;
                                const preferredProviderId = processedProviders.some((provider) => provider.id === configuredDefaultProviderId)
                                    ? configuredDefaultProviderId
                                    : undefined;
                                const currentSettingsSelection = state.activeDirectoryKey === directoryKey
                                    ? state.selectedProviderId
                                    : baseSnapshot.selectedProviderId;
                                const selectedProviderId = resolveSettingsProviderSelection(
                                    currentSettingsSelection,
                                    preferredProviderId,
                                    processedProviders[0]?.id,
                                );

                                const nextSnapshot: DirectoryScopedConfig = {
                                    ...baseSnapshot,
                                    providers: processedProviders,
                                    defaultProviders: defaults,
                                    selectedProviderId,
                                };

                                const nextState: Partial<ConfigStore> = {
                                    directoryScoped: {
                                        ...state.directoryScoped,
                                        [directoryKey]: nextSnapshot,
                                    },
                                };

                                if (state.activeDirectoryKey === directoryKey) {
                                    nextState.providers = processedProviders;
                                    nextState.defaultProviders = defaults;
                                    nextState.selectedProviderId = selectedProviderId;

                                    if (!state.currentProviderId && !state.currentModelId && state.settingsDefaultModel) {
                                        const parsed = parseModelString(state.settingsDefaultModel);
                                        if (parsed) {
                                            const settingsProvider = processedProviders.find((p) => p.id === parsed.providerId);
                                            if (settingsProvider?.models.some((m) => m.id === parsed.modelId)) {
                                                const model = settingsProvider.models.find((m) => m.id === parsed.modelId);
                                                const currentVariant = state.settingsDefaultVariant && (model as { variants?: Record<string, unknown> } | undefined)?.variants?.[state.settingsDefaultVariant]
                                                    ? state.settingsDefaultVariant
                                                    : undefined;

                                                nextState.currentProviderId = parsed.providerId;
                                                nextState.currentModelId = parsed.modelId;
                                                nextState.currentVariant = currentVariant;

                                                nextSnapshot.currentProviderId = parsed.providerId;
                                                nextSnapshot.currentModelId = parsed.modelId;
                                                nextSnapshot.currentVariant = currentVariant;
                                            }
                                        }
                                    }
                                }

                                return nextState;
                            });

                            const loaderEnded = typeof performance !== 'undefined' ? performance.now() : Date.now();
                            markStartupTrace('loadProviders:end', {
                                directoryKey,
                                serverId,
                                source,
                                requestedDirectory: targetDirectory,
                                effectiveDirectory,
                                durationMs: Math.round(loaderEnded - loaderStarted),
                                providers: processedProviders.length,
                                models: processedProviders.reduce((count, provider) => count + provider.models.length, 0),
                            });
                            return;
                        } catch (error) {
                            lastError = error;
                            markStartupTrace('loadProviders:attemptError', {
                                directoryKey,
                                serverId,
                                source,
                                requestedDirectory: targetDirectory,
                                effectiveDirectory,
                                attempt: attempt + 1,
                                error: error instanceof Error ? error.message : String(error),
                            });
                            const waitMs = 200 * (attempt + 1);
                            await new Promise((resolve) => setTimeout(resolve, waitMs));
                        }
                    }

                    const loaderEnded = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    console.error("Failed to load providers:", {
                        endpoint: '/config/providers',
                        directory: effectiveDirectory,
                        directoryKey,
                        serverId,
                        source,
                        attempts: 3,
                        durationMs: Math.round(loaderEnded - loaderStarted),
                        error: lastError,
                    });
                    markStartupTrace('loadProviders:error', {
                        directoryKey,
                        serverId,
                        source,
                        requestedDirectory: targetDirectory,
                        effectiveDirectory,
                        error: lastError instanceof Error ? lastError.message : String(lastError),
                    });

                    set((state) => {
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: [],
                            agents: [],
                            currentProviderId: "",
                            currentModelId: "",
                            currentAgentName: undefined,
                            selectedProviderId: "",
                            agentModelSelections: {},
                            defaultProviders: {},
                        };
                        const configuredDefaultProviderId = state.settingsDefaultModel
                            ? parseModelString(state.settingsDefaultModel)?.providerId
                            : undefined;
                        const preferredProviderId = previousProviders.some((provider) => provider.id === configuredDefaultProviderId)
                            ? configuredDefaultProviderId
                            : undefined;
                        const currentSettingsSelection = state.activeDirectoryKey === directoryKey
                            ? state.selectedProviderId
                            : baseSnapshot.selectedProviderId;
                        const selectedProviderId = resolveSettingsProviderSelection(
                            currentSettingsSelection,
                            preferredProviderId,
                            previousProviders[0]?.id,
                        );

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            providers: previousProviders,
                            defaultProviders: previousDefaults,
                            selectedProviderId,
                        };

                        const nextState: Partial<ConfigStore> = {
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };

                        if (state.activeDirectoryKey === directoryKey) {
                            nextState.providers = previousProviders;
                            nextState.defaultProviders = previousDefaults;
                            nextState.selectedProviderId = selectedProviderId;

                            if (!state.currentProviderId && !state.currentModelId && state.settingsDefaultModel) {
                                const parsed = parseModelString(state.settingsDefaultModel);
                                if (parsed) {
                                    const settingsProvider = previousProviders.find((p) => p.id === parsed.providerId);
                                    if (settingsProvider?.models.some((m) => m.id === parsed.modelId)) {
                                        const model = settingsProvider.models.find((m) => m.id === parsed.modelId);
                                        const currentVariant = state.settingsDefaultVariant && (model as { variants?: Record<string, unknown> } | undefined)?.variants?.[state.settingsDefaultVariant]
                                            ? state.settingsDefaultVariant
                                            : undefined;

                                        nextState.currentProviderId = parsed.providerId;
                                        nextState.currentModelId = parsed.modelId;
                                        nextState.currentVariant = currentVariant;

                                        nextSnapshot.currentProviderId = parsed.providerId;
                                        nextSnapshot.currentModelId = parsed.modelId;
                                        nextSnapshot.currentVariant = currentVariant;
                                    }
                                }
                            }
                        }

                        return nextState;
                    });
                    })().finally(() => _inFlightProviders.delete(directoryKey));

                    _inFlightProviders.set(directoryKey, promise);
                    return promise;
                },

                setProvider: (providerId: string) => {
                    const { providers } = get();
                    const provider = providers.find((p) => p.id === providerId);
                    const isAuto = providerId === AUTO_PROVIDER_ID && hasProviderModel(providers, AUTO_PROVIDER_ID, AUTO_MODEL_ID);

                    if (!provider && !isAuto) {
                        return;
                    }

                    const firstModel = provider?.models[0];
                    const newModelId = isAuto ? AUTO_MODEL_ID : (firstModel?.id || "");
 
                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentVariant: state.currentVariant,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentProviderId: providerId,
                            currentModelId: newModelId,
                        };

                        return {
                            currentProviderId: providerId,
                            currentModelId: newModelId,
                            selectionSource: "manual",
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: {
                                    ...nextSnapshot,
                                    selectionSource: "manual",
                                },
                            },
                        };
                    });
                },

                setModel: (modelId: string) => {
                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentVariant: state.currentVariant,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };
 
                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentModelId: modelId,
                            selectionSource: "manual",
                        };
 
                        return {
                            currentModelId: modelId,
                            selectionSource: "manual",
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                setCurrentVariant: (variant: string | undefined) => {
                    set((state) => {
                        if (state.currentVariant === variant) {
                            return state;
                        }

                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentVariant: state.currentVariant,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentVariant: variant,
                            selectionSource: "manual",
                        };

                        return {
                            currentVariant: variant,
                            selectionSource: "manual",
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                getCurrentModelVariants: () => {
                    const model = get().getCurrentModel();
                    const variants = (model as { variants?: Record<string, unknown> } | undefined)?.variants;
                    if (!variants) {
                        return [];
                    }
                    return Object.keys(variants);
                },

                cycleCurrentVariant: () => {
                    const variantKeys = get().getCurrentModelVariants();
                    if (variantKeys.length === 0) {
                        return;
                    }

                    const current = get().currentVariant;
                    if (!current) {
                        get().setCurrentVariant(variantKeys[0]);
                        return;
                    }

                    const index = variantKeys.indexOf(current);
                    if (index === -1 || index === variantKeys.length - 1) {
                        get().setCurrentVariant(undefined);
                        return;
                    }

                    get().setCurrentVariant(variantKeys[index + 1]);
                },
 
                setSelectedProvider: (providerId: string) => {
                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            selectedProviderId: providerId,
                        };

                        return {
                            selectedProviderId: providerId,
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                saveAgentModelSelection: (agentName: string, providerId: string, modelId: string) => {
                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const nextSelections = {
                            ...state.agentModelSelections,
                            [agentName]: { providerId, modelId },
                        };

                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            agentModelSelections: nextSelections,
                        };

                        return {
                            agentModelSelections: nextSelections,
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });
                },

                getAgentModelSelection: (agentName: string) => {
                    const { agentModelSelections } = get();
                    return agentModelSelections[agentName] || null;
                },

                loadAgents: async (options) => {
                    const targetDirectory = options?.directory ?? fromDirectoryKey(get().activeDirectoryKey);
                    const serverId = resolveConfigServerId(targetDirectory, options?.serverId, get().activeDirectoryKey);
                    const directoryKey = toDirectoryKey(targetDirectory, serverId);
                    const source = options?.source ?? 'unknown';
                    const effectiveDirectory = targetDirectory ?? getOpencodeDirectory();
                    markStartupTrace('loadAgents:called', { directoryKey, serverId, source, requestedDirectory: targetDirectory, effectiveDirectory });

                    // Dedup: if a load is already in-flight for this directory, reuse it
                    const existing = _inFlightAgents.get(directoryKey);
                    if (existing) {
                        markStartupTrace('loadAgents:deduped', { directoryKey, serverId, source, requestedDirectory: targetDirectory, effectiveDirectory });
                        return existing;
                    }

                    const promise = (async (): Promise<boolean> => {
                    const loaderStarted = typeof performance !== 'undefined' ? performance.now() : Date.now();
                    markStartupTrace('loadAgents:start', { directoryKey, serverId, source, requestedDirectory: targetDirectory, effectiveDirectory });
                    const existingSnapshot = get().directoryScoped[directoryKey];
                    const previousAgents = existingSnapshot?.agents ?? (get().activeDirectoryKey === directoryKey ? get().agents : []);
                    let lastError: unknown = null;

                    for (let attempt = 0; attempt < 3; attempt++) {
                        try {
                            // Fetch agents and OpenChamber settings in parallel
                            const targetDir = fromDirectoryKey(directoryKey)
                            const serverBaseUrl = options?.serverBaseUrl ?? resolveConfigServerBaseUrl(targetDir, serverId)
                            const initialSyncedOpencodeConfig = getSyncConfig(targetDirectory ?? undefined, serverId)
                                ?? getSyncConfig(targetDir ?? undefined, serverId);
                            if (initialSyncedOpencodeConfig) {
                                markStartupTrace('loadAgents:syncConfigHit', { directoryKey, serverId, source });
                            }

                            const [rawAgents, openChamberDefaults] = await Promise.all([
                                measureStartupTrace(
                                    'loadAgents:api',
                                    // R2 client unification: agent list from the
                                    // v2 agent.list route (throws on failure so
                                    // the retry loop below observes it).
                                    () => opencodeClient.listAgents(targetDir ?? undefined, serverId ?? undefined),
                                    { directoryKey, serverId, source, requestedDirectory: targetDirectory, effectiveDirectory, attempt: attempt + 1 },
                                ),
                                fetchOpenChamberDefaults(serverBaseUrl),
                            ]);

                            // OpenCode defaults come from sync bootstrap (non-blocking). Do not await config.get here.
                            const latestSyncedOpencodeConfig = getSyncConfig(targetDirectory ?? undefined, serverId)
                                ?? getSyncConfig(targetDir ?? undefined, serverId)
                                ?? initialSyncedOpencodeConfig;
                            const hasLatestSyncedOpencodeConfig = !!latestSyncedOpencodeConfig;
                            const syncedOpencodeDefaultAgent = normalizeOptionalString(latestSyncedOpencodeConfig?.default_agent);
                            const syncedOpencodeDefaultModel = normalizeOptionalString(latestSyncedOpencodeConfig?.model);

                            // Projected v2 agents; the store still types the
                            // legacy wire Agent (R2 残留: sync-bridge retype).
                            const safeAgents = Array.isArray(rawAgents) ? rawAgents as unknown as Agent[] : [];

                            const providerLoad = _inFlightProviders.get(directoryKey);
                            if (providerLoad) {
                                markStartupTrace('loadAgents:awaitProviders', { directoryKey, serverId, source });
                                await providerLoad;
                            }

                            const providers = get().activeDirectoryKey === directoryKey
                                ? get().providers
                                : (get().directoryScoped[directoryKey]?.providers ?? []);

                            const existingZenModel = normalizeOptionalString(get().settingsZenModel);

                            const defaultZenModel = normalizeOptionalString(openChamberDefaults.zenModel);

                            const resolvedExistingGitSelection = resolveGitGenerationModelSelection({
                                providers,
                                settingsZenModel: existingZenModel,
                            });

                            const resolvedDefaultGitSelection = resolveGitGenerationModelSelection({
                                providers,
                                settingsZenModel: defaultZenModel,
                            });

                            const resolvedGitSelection = resolvedExistingGitSelection || resolvedDefaultGitSelection;
                            const resolvedGitModelId = resolvedGitSelection?.modelId;
                            const resolvedZenModel = resolvedGitModelId || defaultZenModel || existingZenModel;

                            set((state) => {
                                const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                                    providers,
                                    agents: previousAgents,
                                    currentProviderId: "",
                                    currentModelId: "",
                                    currentAgentName: undefined,
                                    selectedProviderId: "",
                                    agentModelSelections: {},
                                    defaultProviders: {},
                                };

                                // Guard the midpoint until the selection-resolution set below runs:
                                // dropping a now-hidden currentAgentName here prevents any subscriber
                                // from observing a hidden selection between the two sets.
                                const visibleNamesAfterUpdate = new Set(
                                    filterVisibleAgents(safeAgents).map((agent) => agent.name),
                                );
                                const isActiveDir = state.activeDirectoryKey === directoryKey;
                                const activeCurrentAgentName = isActiveDir ? state.currentAgentName : undefined;
                                const scopedCurrentAgentName = baseSnapshot.currentAgentName;
                                const safeScopedAgentName =
                                    scopedCurrentAgentName && visibleNamesAfterUpdate.has(scopedCurrentAgentName)
                                        ? scopedCurrentAgentName
                                        : undefined;
                                const safeActiveAgentName =
                                    activeCurrentAgentName && visibleNamesAfterUpdate.has(activeCurrentAgentName)
                                        ? activeCurrentAgentName
                                        : undefined;

                                const nextSnapshot: DirectoryScopedConfig = {
                                    ...baseSnapshot,
                                    providers,
                                    agents: safeAgents,
                                    currentAgentName: safeScopedAgentName,
                                };

                                const nextState: Partial<ConfigStore> = {
                                    settingsDefaultModel: openChamberDefaults.defaultModel,
                                    settingsDefaultVariant: openChamberDefaults.defaultVariant,
                                    settingsDefaultAgent: openChamberDefaults.defaultAgent,
                                    settingsAutoCreateWorktree: openChamberDefaults.autoCreateWorktree ?? false,
                                    settingsGitmojiEnabled: openChamberDefaults.gitmojiEnabled ?? false,
                                    settingsDefaultFileViewerPreview: openChamberDefaults.defaultFileViewerPreview ?? true,
                                    settingsZenModel: resolvedZenModel,
                                    settingsMessageStreamTransport: openChamberDefaults.messageStreamTransport ?? state.settingsMessageStreamTransport ?? 'ws',
                                    sttProvider: openChamberDefaults.sttProvider ?? state.sttProvider,
                                    sttServerUrl: openChamberDefaults.sttServerUrl ?? state.sttServerUrl,
                                    sttModel: openChamberDefaults.sttModel ?? state.sttModel,
                                    sttLanguage: openChamberDefaults.sttLanguage ?? state.sttLanguage,
                                    sttSilenceThresholdDb: openChamberDefaults.sttSilenceThresholdDb ?? state.sttSilenceThresholdDb,
                                    sttSilenceHoldMs: openChamberDefaults.sttSilenceHoldMs ?? state.sttSilenceHoldMs,
                                    directoryScoped: {
                                        ...state.directoryScoped,
                                        [directoryKey]: nextSnapshot,
                                    },
                                };

                                if (isActiveDir) {
                                    nextState.agents = safeAgents;
                                    nextState.currentAgentName = safeActiveAgentName;
                                }

                                return nextState;
                            });

                            const shouldPersistResolvedZenModel =
                                !!resolvedZenModel &&
                                resolvedZenModel !== defaultZenModel;

                            if (shouldPersistResolvedZenModel && resolvedZenModel) {
                                persistOpenChamberSettingsPatch({
                                    zenModel: resolvedZenModel,
                                    gitProviderId: '',
                                    gitModelId: '',
                                }, serverBaseUrl).catch(() => {
                                    // Ignore errors - best effort cleanup
                                });
                            }

                            if (safeAgents.length === 0) {
                                set((state) => {
                                    const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? createEmptyDirectoryScopedConfig(providers, []);
                                    const opencodeDefaultAgent = hasLatestSyncedOpencodeConfig
                                        ? syncedOpencodeDefaultAgent
                                        : baseSnapshot.opencodeDefaultAgent ?? (state.activeDirectoryKey === directoryKey ? state.opencodeDefaultAgent : undefined);
                                    const opencodeDefaultModel = hasLatestSyncedOpencodeConfig
                                        ? syncedOpencodeDefaultModel
                                        : baseSnapshot.opencodeDefaultModel ?? (state.activeDirectoryKey === directoryKey ? state.opencodeDefaultModel : undefined);

                                    const nextSnapshot: DirectoryScopedConfig = {
                                        ...baseSnapshot,
                                        providers,
                                        agents: [],
                                        currentAgentName: undefined,
                                        opencodeDefaultAgent,
                                        opencodeDefaultModel,
                                    };

                                    const nextState: Partial<ConfigStore> = {
                                        directoryScoped: {
                                            ...state.directoryScoped,
                                            [directoryKey]: nextSnapshot,
                                        },
                                    };

                                    if (state.activeDirectoryKey === directoryKey) {
                                        nextState.currentAgentName = undefined;
                                        nextState.opencodeDefaultAgent = opencodeDefaultAgent;
                                        nextState.opencodeDefaultModel = opencodeDefaultModel;
                                    }

                                    return nextState;
                                });

                                const loaderEnded = typeof performance !== 'undefined' ? performance.now() : Date.now();
                                markStartupTrace('loadAgents:end', {
                                    directoryKey,
                                    serverId,
                                    source,
                                    requestedDirectory: targetDirectory,
                                    effectiveDirectory,
                                    durationMs: Math.round(loaderEnded - loaderStarted),
                                    agents: safeAgents.length,
                                });
                                return true;
                            }

                            // Track invalid settings to clear and harmless corrections to persist.
                            // resolveConfiguredAgentName runs against safeAgents (not visibleAgents)
                            // because a hidden-but-existing defaultAgent is user intent, not invalid.
                            const settingsPatch: OpenChamberSettingsPatch = {};
                            const visibleAgents = filterVisibleAgents(safeAgents);
                            const configuredAgent = resolveConfiguredAgentName(openChamberDefaults.defaultAgent, safeAgents);
                            if (configuredAgent.correctedName) settingsPatch.defaultAgent = configuredAgent.correctedName;
                            else if (configuredAgent.invalid) settingsPatch.defaultAgent = '';

                            if (openChamberDefaults.defaultModel) {
                                const parsed = parseModelString(openChamberDefaults.defaultModel);
                                if (!parsed || !hasProviderModel(providers, parsed.providerId, parsed.modelId)) {
                                    settingsPatch.defaultModel = '';
                                } else if (openChamberDefaults.defaultVariant) {
                                    if (!hasValidVariant(providers, parsed.providerId, parsed.modelId, openChamberDefaults.defaultVariant)) {
                                        settingsPatch.defaultVariant = '';
                                    }
                                }
                            }

                            const latestSnapshot = get().directoryScoped[directoryKey];
                            const latestConfigState = get();
                            const opencodeDefaultAgent = hasLatestSyncedOpencodeConfig
                                ? syncedOpencodeDefaultAgent
                                : latestSnapshot?.opencodeDefaultAgent
                                    ?? (latestConfigState.activeDirectoryKey === directoryKey ? latestConfigState.opencodeDefaultAgent : undefined);
                            const opencodeDefaultModel = hasLatestSyncedOpencodeConfig
                                ? syncedOpencodeDefaultModel
                                : latestSnapshot?.opencodeDefaultModel
                                    ?? (latestConfigState.activeDirectoryKey === directoryKey ? latestConfigState.opencodeDefaultModel : undefined);

                            const resolvedDefault = resolveDefaultAgentModelSelection({
                                agents: safeAgents,
                                providers,
                                settingsDefaultAgent: openChamberDefaults.defaultAgent,
                                settingsDefaultModel: openChamberDefaults.defaultModel,
                                settingsDefaultVariant: openChamberDefaults.defaultVariant,
                                opencodeDefaultAgent,
                                opencodeDefaultModel,
                            });
                            const resolvedAgentName = resolvedDefault.agentName ?? visibleAgents[0]?.name;
                            const resolvedProviderId = resolvedDefault.providerId;
                            const resolvedModelId = resolvedDefault.modelId;
                            const resolvedVariant = resolvedDefault.variant;

                            set((state) => {
                                const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? createEmptyDirectoryScopedConfig(providers, safeAgents);
                                const isActive = state.activeDirectoryKey === directoryKey;
                                const currentAgentName = isActive ? state.currentAgentName : baseSnapshot.currentAgentName;
                                const currentProviderId = isActive ? state.currentProviderId : baseSnapshot.currentProviderId;
                                const currentModelId = isActive ? state.currentModelId : baseSnapshot.currentModelId;
                                const currentVariant = isActive ? state.currentVariant : baseSnapshot.currentVariant;
                                const selectionSource = isActive ? state.selectionSource : (baseSnapshot.selectionSource ?? "auto");
                                const nextSelection = resolveSelectionWithManualGuard({
                                    agents: safeAgents,
                                    providers,
                                    currentAgentName,
                                    currentProviderId,
                                    currentModelId,
                                    currentVariant,
                                    selectionSource,
                                    resolvedAgentName,
                                    resolvedProviderId,
                                    resolvedModelId,
                                    resolvedVariant,
                                });

                                const nextSnapshot: DirectoryScopedConfig = {
                                    ...baseSnapshot,
                                    providers,
                                    agents: safeAgents,
                                    currentAgentName: nextSelection.agentName,
                                    currentProviderId: nextSelection.providerId ?? baseSnapshot.currentProviderId,
                                    currentModelId: nextSelection.modelId ?? baseSnapshot.currentModelId,
                                    currentVariant: nextSelection.variant,
                                    opencodeDefaultAgent,
                                    opencodeDefaultModel,
                                    selectionSource: nextSelection.selectionSource,
                                };

                                const nextState: Partial<ConfigStore> = {
                                    directoryScoped: {
                                        ...state.directoryScoped,
                                        [directoryKey]: nextSnapshot,
                                    },
                                };

                                if (isActive) {
                                    nextState.currentAgentName = nextSelection.agentName;
                                    nextState.opencodeDefaultAgent = opencodeDefaultAgent;
                                    nextState.opencodeDefaultModel = opencodeDefaultModel;
                                    nextState.selectionSource = nextSelection.selectionSource;
                                    if (nextSelection.providerId && nextSelection.modelId) {
                                        nextState.currentProviderId = nextSelection.providerId;
                                        nextState.currentModelId = nextSelection.modelId;
                                        nextState.currentVariant = nextSelection.variant;
                                    }
                                }

                                return nextState;
                            });

                            // Clear invalid settings from storage (best-effort cleanup)
                            if (Object.keys(settingsPatch).length > 0) {
                                // Also clear from store state
                                 set({
                                     settingsDefaultModel: settingsPatch.defaultModel === '' ? undefined : settingsPatch.defaultModel ?? get().settingsDefaultModel,
                                     settingsDefaultVariant: settingsPatch.defaultVariant === '' ? undefined : settingsPatch.defaultVariant ?? get().settingsDefaultVariant,
                                     settingsDefaultAgent: settingsPatch.defaultAgent === '' ? undefined : settingsPatch.defaultAgent ?? get().settingsDefaultAgent,
                                 });
                                persistOpenChamberSettingsPatch(settingsPatch, serverBaseUrl).catch(() => {
                                    // Ignore errors - best effort cleanup
                                });
                            }

                            const loaderEnded = typeof performance !== 'undefined' ? performance.now() : Date.now();
                            markStartupTrace('loadAgents:end', {
                                directoryKey,
                                serverId,
                                source,
                                requestedDirectory: targetDirectory,
                                effectiveDirectory,
                                durationMs: Math.round(loaderEnded - loaderStarted),
                                agents: safeAgents.length,
                            });
                            return true;
                        } catch (error) {
                            lastError = error;
                            markStartupTrace('loadAgents:attemptError', {
                                directoryKey,
                                serverId,
                                source,
                                requestedDirectory: targetDirectory,
                                effectiveDirectory,
                                attempt: attempt + 1,
                                error: error instanceof Error ? error.message : String(error),
                            });
                            const waitMs = 200 * (attempt + 1);
                            await new Promise((resolve) => setTimeout(resolve, waitMs));
                        }
                    }

                    console.error("Failed to load agents:", lastError);
                    markStartupTrace('loadAgents:error', {
                        directoryKey,
                        serverId,
                        source,
                        requestedDirectory: targetDirectory,
                        effectiveDirectory,
                        error: lastError instanceof Error ? lastError.message : String(lastError),
                    });

                    set((state) => {
                        const providers = state.activeDirectoryKey === directoryKey
                            ? state.providers
                            : (state.directoryScoped[directoryKey]?.providers ?? []);

                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers,
                            agents: [],
                            currentProviderId: "",
                            currentModelId: "",
                            currentAgentName: undefined,
                            selectedProviderId: "",
                            agentModelSelections: {},
                            defaultProviders: {},
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            providers,
                            agents: previousAgents,
                        };

                        const nextState: Partial<ConfigStore> = {
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };

                        if (state.activeDirectoryKey === directoryKey) {
                            nextState.agents = previousAgents;
                        }

                        return nextState;
                    });

                    return false;
                    })().finally(() => _inFlightAgents.delete(directoryKey));

                    _inFlightAgents.set(directoryKey, promise);
                    return promise;
                },

                invalidateModelMetadataCache: () => {
                    modelsMetadataInFlight = null;
                    set({ modelsMetadata: new Map<string, ModelMetadata>() });
                },

                setAgent: (agentName: string | undefined) => {
                    const {
                        agents,
                        providers,
                        settingsDefaultModel,
                        settingsDefaultVariant,
                        currentProviderId,
                        currentModelId,
                    } = get();

                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                            providers: state.providers,
                            agents: state.agents,
                            currentProviderId: state.currentProviderId,
                            currentModelId: state.currentModelId,
                            currentAgentName: state.currentAgentName,
                            selectedProviderId: state.selectedProviderId,
                            agentModelSelections: state.agentModelSelections,
                            defaultProviders: state.defaultProviders,
                        };

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentAgentName: agentName,
                            selectionSource: "manual",
                        };

                        return {
                            currentAgentName: agentName,
                            selectionSource: "manual",
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                        };
                    });

                    if (agentName) {
                        const { currentSessionId } = useSessionUIStore.getState();
                        const selState = useSelectionStore.getState();

                        if (currentSessionId) {
                            selState.saveSessionAgentSelection(currentSessionId, agentName);
                        }

                        if (currentSessionId && useSessionUIStore.getState().isOpenChamberCreatedSession(currentSessionId)) {
                            const existingAgentModel = selState.getAgentModelForSession(currentSessionId, agentName);
                            if (!existingAgentModel) {
                                useSessionUIStore.getState().initializeNewOpenChamberSession(currentSessionId, agents);
                            }
                        }
                    }

                    if (agentName) {
                        const { currentSessionId } = useSessionUIStore.getState();

                        const applyResolvedModelSelection = (providerId: string, modelId: string, variant?: string) => {
                            set((state) => {
                                const directoryKey = state.activeDirectoryKey;
                                const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? {
                                    providers: state.providers,
                                    agents: state.agents,
                                    currentProviderId: state.currentProviderId,
                                    currentModelId: state.currentModelId,
                                    currentVariant: state.currentVariant,
                                    currentAgentName: state.currentAgentName,
                                    selectedProviderId: state.selectedProviderId,
                                    agentModelSelections: state.agentModelSelections,
                                    defaultProviders: state.defaultProviders,
                                };

                                const nextSnapshot: DirectoryScopedConfig = {
                                    ...baseSnapshot,
                                    currentProviderId: providerId,
                                    currentModelId: modelId,
                                    currentVariant: variant,
                                };

                                return {
                                    currentProviderId: providerId,
                                    currentModelId: modelId,
                                    currentVariant: variant,
                                    directoryScoped: {
                                        ...state.directoryScoped,
                                        [directoryKey]: nextSnapshot,
                                    },
                                };
                            });
                        };

                        const resolveVariantForModel = (
                            providerId: string,
                            modelId: string,
                            agentVariant?: string,
                        ): string | undefined => {
                            const model = providers
                                .find((provider) => provider.id === providerId)
                                ?.models.find((candidate) => candidate.id === modelId) as { variants?: Record<string, unknown> } | undefined;
                            const savedVariant = currentSessionId
                                ? useSelectionStore.getState().getAgentModelVariantForSession(
                                    currentSessionId,
                                    agentName,
                                    providerId,
                                    modelId,
                                )
                                : undefined;
                            return resolveModelVariant({
                                variants: model?.variants,
                                savedVariant,
                                agentVariant,
                                defaultVariant: settingsDefaultVariant,
                            });
                        };

                        const agent = agents.find((candidate) => candidate.name === agentName);

                        if (currentSessionId) {
                            const existingAgentModel = useSelectionStore.getState().getAgentModelForSession(currentSessionId, agentName);
                            if (existingAgentModel && hasProviderModel(providers, existingAgentModel.providerId, existingAgentModel.modelId)) {
                                const resolvedVariant = resolveVariantForModel(
                                    existingAgentModel.providerId,
                                    existingAgentModel.modelId,
                                    agent?.variant,
                                );
                                if (
                                    currentProviderId !== existingAgentModel.providerId
                                    || currentModelId !== existingAgentModel.modelId
                                    || get().currentVariant !== resolvedVariant
                                ) {
                                    applyResolvedModelSelection(
                                        existingAgentModel.providerId,
                                        existingAgentModel.modelId,
                                        resolvedVariant,
                                    );
                                }
                                return;
                            }
                        }

                        const agentModelSelection = agent?.model;
                        if (agentModelSelection?.providerID && agentModelSelection?.modelID) {
                            const { providerID, modelID } = agentModelSelection;
                            const agentProvider = providers.find((provider) => provider.id === providerID);
                            const agentModel = agentProvider?.models.find((model) => model.id === modelID);

                            if (agentModel) {
                                applyResolvedModelSelection(
                                    providerID,
                                    modelID,
                                    resolveVariantForModel(providerID, modelID, agent?.variant),
                                );
                                return;
                            }
                        }

                        if (settingsDefaultModel) {
                            const parsed = parseModelString(settingsDefaultModel);
                            if (parsed) {
                                const settingsProvider = providers.find((p) => p.id === parsed.providerId);
                                if (settingsProvider?.models.some((m) => m.id === parsed.modelId)) {
                                    applyResolvedModelSelection(
                                        parsed.providerId,
                                        parsed.modelId,
                                        resolveVariantForModel(parsed.providerId, parsed.modelId, agent?.variant),
                                    );
                                    return;
                                }
                            }
                        }

                    }
                },

                applyDefaultModelAgentSelection: (options) => {
                    const {
                        agents,
                        providers,
                        settingsDefaultModel,
                        settingsDefaultVariant,
                        settingsDefaultAgent,
                        opencodeDefaultAgent,
                        opencodeDefaultModel,
                        selectionSource,
                        currentAgentName,
                        currentProviderId,
                        currentModelId,
                        currentVariant,
                    } = get();

                    if (agents.length === 0 || providers.length === 0) {
                        return;
                    }

                    const resolved = resolveDefaultAgentModelSelection({
                        agents,
                        providers,
                        projectDefaultModel: options?.projectDefaultModel,
                        projectDefaultVariant: options?.projectDefaultVariant,
                        settingsDefaultAgent,
                        settingsDefaultModel,
                        settingsDefaultVariant,
                        opencodeDefaultAgent,
                        opencodeDefaultModel,
                    });
                    if (!resolved.agentName) {
                        return;
                    }

                    const nextSelection = resolveSelectionWithManualGuard({
                        agents,
                        providers,
                        currentAgentName,
                        currentProviderId,
                        currentModelId,
                        currentVariant,
                        selectionSource,
                        resolvedAgentName: resolved.agentName,
                        resolvedProviderId: resolved.providerId,
                        resolvedModelId: resolved.modelId,
                        resolvedVariant: resolved.variant,
                    });

                    set((state) => {
                        const directoryKey = state.activeDirectoryKey;
                        const baseSnapshot: DirectoryScopedConfig = state.directoryScoped[directoryKey] ?? createEmptyDirectoryScopedConfig(state.providers, state.agents);

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            currentAgentName: nextSelection.agentName,
                            selectionSource: nextSelection.selectionSource,
                            ...(nextSelection.providerId && nextSelection.modelId
                                ? {
                                    currentProviderId: nextSelection.providerId,
                                    currentModelId: nextSelection.modelId,
                                    currentVariant: nextSelection.variant,
                                }
                                : {}),
                        };

                        return {
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: nextSnapshot,
                            },
                            currentAgentName: nextSelection.agentName,
                            selectionSource: nextSelection.selectionSource,
                            ...(nextSelection.providerId && nextSelection.modelId
                                ? {
                                    currentProviderId: nextSelection.providerId,
                                    currentModelId: nextSelection.modelId,
                                    currentVariant: nextSelection.variant,
                                }
                                : {}),
                        };
                    });
                },

                applyOpenCodeConfigDefaults: (directory, source = "syncConfig", config, serverId) => {
                    const activeKey = get().activeDirectoryKey;
                    const eventDirectory = directory ?? fromDirectoryKey(activeKey);
                    const resolvedServerId = resolveConfigServerId(eventDirectory, serverId, activeKey);
                    const directoryKey = toDirectoryKey(eventDirectory, resolvedServerId);
                    const syncedConfig = config
                        ?? getSyncConfig(eventDirectory ?? undefined, resolvedServerId)
                        ?? getSyncConfig(fromDirectoryKey(directoryKey) ?? undefined, resolvedServerId);
                    if (!syncedConfig) {
                        return;
                    }

                    const opencodeDefaultAgent = normalizeOptionalString(syncedConfig.default_agent);
                    const opencodeDefaultModel = normalizeOptionalString(syncedConfig.model);
                    markStartupTrace('applyOpenCodeConfigDefaults', {
                        directoryKey,
                        serverId: resolvedServerId,
                        source,
                        hasAgent: !!opencodeDefaultAgent,
                        hasModel: !!opencodeDefaultModel,
                    });

                    set((state) => {
                        const snapshot = state.directoryScoped[directoryKey];
                        const isActive = state.activeDirectoryKey === directoryKey;
                        const providers = isActive ? state.providers : (snapshot?.providers ?? []);
                        const agents = isActive ? state.agents : (snapshot?.agents ?? []);
                        const baseSnapshot: DirectoryScopedConfig = snapshot ?? createEmptyDirectoryScopedConfig(providers, agents);
                        const defaultsChanged = baseSnapshot.opencodeDefaultAgent !== opencodeDefaultAgent
                            || baseSnapshot.opencodeDefaultModel !== opencodeDefaultModel
                            || (isActive && (
                                state.opencodeDefaultAgent !== opencodeDefaultAgent
                                || state.opencodeDefaultModel !== opencodeDefaultModel
                            ));
                        const defaultsSnapshot: DirectoryScopedConfig = {
                            ...baseSnapshot,
                            providers,
                            agents,
                            opencodeDefaultAgent,
                            opencodeDefaultModel,
                        };
                        const nextState: Partial<ConfigStore> = {
                            directoryScoped: {
                                ...state.directoryScoped,
                                [directoryKey]: defaultsSnapshot,
                            },
                        };

                        if (isActive) {
                            nextState.opencodeDefaultAgent = opencodeDefaultAgent;
                            nextState.opencodeDefaultModel = opencodeDefaultModel;
                        }

                        const selectionSource = isActive ? state.selectionSource : (snapshot?.selectionSource ?? "auto");

                        if (providers.length === 0 || agents.length === 0) {
                            if (!defaultsChanged) {
                                return state;
                            }
                            return nextState;
                        }

                        const resolved = resolveDefaultAgentModelSelection({
                            agents,
                            providers,
                            settingsDefaultAgent: state.settingsDefaultAgent,
                            settingsDefaultModel: state.settingsDefaultModel,
                            settingsDefaultVariant: state.settingsDefaultVariant,
                            opencodeDefaultAgent,
                            opencodeDefaultModel,
                        });

                        if (!resolved.agentName) {
                            if (!defaultsChanged) {
                                return state;
                            }
                            return nextState;
                        }

                        const currentAgentName = isActive ? state.currentAgentName : baseSnapshot.currentAgentName;
                        const currentProviderId = isActive ? state.currentProviderId : baseSnapshot.currentProviderId;
                        const currentModelId = isActive ? state.currentModelId : baseSnapshot.currentModelId;
                        const currentVariant = isActive ? state.currentVariant : baseSnapshot.currentVariant;
                        const nextSelection = resolveSelectionWithManualGuard({
                            agents,
                            providers,
                            currentAgentName,
                            currentProviderId,
                            currentModelId,
                            currentVariant,
                            selectionSource,
                            resolvedAgentName: resolved.agentName,
                            resolvedProviderId: resolved.providerId,
                            resolvedModelId: resolved.modelId,
                            resolvedVariant: resolved.variant,
                        });

                        const nextSnapshot: DirectoryScopedConfig = {
                            ...defaultsSnapshot,
                            currentAgentName: nextSelection.agentName,
                            selectionSource: nextSelection.selectionSource,
                            ...(nextSelection.providerId && nextSelection.modelId
                                ? {
                                    currentProviderId: nextSelection.providerId,
                                    currentModelId: nextSelection.modelId,
                                    currentVariant: nextSelection.variant,
                                }
                                : {}),
                        };

                        const selectionChanged = baseSnapshot.currentAgentName !== nextSnapshot.currentAgentName
                            || baseSnapshot.currentProviderId !== nextSnapshot.currentProviderId
                            || baseSnapshot.currentModelId !== nextSnapshot.currentModelId
                            || baseSnapshot.currentVariant !== nextSnapshot.currentVariant
                            || (baseSnapshot.selectionSource ?? "auto") !== nextSnapshot.selectionSource
                            || (isActive && (
                                state.currentAgentName !== nextSelection.agentName
                                || state.selectionSource !== nextSelection.selectionSource
                                || (nextSelection.providerId !== undefined && nextSelection.modelId !== undefined && (
                                    state.currentProviderId !== nextSelection.providerId
                                    || state.currentModelId !== nextSelection.modelId
                                    || state.currentVariant !== nextSelection.variant
                                ))
                            ));

                        if (!defaultsChanged && !selectionChanged) {
                            return state;
                        }

                        nextState.directoryScoped = {
                            ...state.directoryScoped,
                            [directoryKey]: nextSnapshot,
                        };

                        if (isActive) {
                            nextState.currentAgentName = nextSelection.agentName;
                            nextState.selectionSource = nextSelection.selectionSource;
                            if (nextSelection.providerId && nextSelection.modelId) {
                                nextState.currentProviderId = nextSelection.providerId;
                                nextState.currentModelId = nextSelection.modelId;
                                nextState.currentVariant = nextSelection.variant;
                            }
                        }

                        return nextState;
                    });
                },

                 setSettingsDefaultModel: (model: string | undefined) => {
                     set({ settingsDefaultModel: model });
                 },

                 setSettingsDefaultVariant: (variant: string | undefined) => {
                     set({ settingsDefaultVariant: variant });
                 },
 
                 setSettingsDefaultAgent: (agent: string | undefined) => {
                     set({ settingsDefaultAgent: agent });
                 },

                setSettingsAutoCreateWorktree: (enabled: boolean) => {
                    set({ settingsAutoCreateWorktree: enabled });
                },

                setSettingsGitmojiEnabled: (enabled: boolean) => {
                    set({ settingsGitmojiEnabled: enabled });
                },

                setSettingsDefaultFileViewerPreview: (enabled: boolean) => {
                    set({ settingsDefaultFileViewerPreview: enabled });
                },

                setSettingsZenModel: (model: string | undefined) => {
                    set({ settingsZenModel: model });
                },

                setSettingsMessageStreamTransport: (transport: 'auto' | 'ws' | 'sse') => {
                    set({ settingsMessageStreamTransport: transport });
                },

                getResolvedGitGenerationModel: () => {
                    const state = get();
                    return resolveGitGenerationModelSelection({
                        providers: state.providers,
                        settingsZenModel: state.settingsZenModel,
                    });
                },

                setVoiceProvider: (provider: 'browser' | 'openai' | 'openai-compatible' | 'say') => {
                    set({ voiceProvider: provider });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('voiceProvider', provider);
                    }
                },

                setSpeechRate: (rate: number) => {
                    const clampedRate = Math.max(0.5, Math.min(2, rate));
                    set({ speechRate: clampedRate });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('speechRate', String(clampedRate));
                    }
                },

                setSpeechPitch: (pitch: number) => {
                    const clampedPitch = Math.max(0.5, Math.min(2, pitch));
                    set({ speechPitch: clampedPitch });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('speechPitch', String(clampedPitch));
                    }
                },

                setSpeechVolume: (volume: number) => {
                    const clampedVolume = Math.max(0, Math.min(1, volume));
                    set({ speechVolume: clampedVolume });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('speechVolume', String(clampedVolume));
                    }
                },

                setSayVoice: (voice: string) => {
                    set({ sayVoice: voice });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sayVoice', voice);
                    }
                },

                setTtsFollowTextLanguage: (enabled: boolean) => {
                    set({ ttsFollowTextLanguage: enabled });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('ttsFollowTextLanguage', String(enabled));
                    }
                },

                setBrowserVoice: (voice: string) => {
                    set({ browserVoice: voice });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('browserVoice', voice);
                    }
                },

                setOpenaiVoice: (voice: string) => {
                    set({ openaiVoice: voice });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('openaiVoice', voice);
                    }
                },

                setOpenaiApiKey: (apiKey: string) => {
                    set({ openaiApiKey: apiKey });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('openaiApiKey', apiKey);
                    }
                },

                setOpenaiCompatibleUrl: (url: string) => {
                    set({ openaiCompatibleUrl: url });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('openaiCompatibleUrl', url);
                    }
                },

                setOpenaiCompatibleApiKey: (apiKey: string) => {
                    set({ openaiCompatibleApiKey: apiKey });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('openaiCompatibleApiKey', apiKey);
                    }
                },

                setOpenaiCompatibleVoice: (voice: string) => {
                    set({ openaiCompatibleVoice: voice });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('openaiCompatibleVoice', voice);
                    }
                },

                setOpenaiCompatibleTtsModel: (model: string) => {
                    set({ openaiCompatibleTtsModel: model });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('openaiCompatibleTtsModel', model);
                    }
                },

                setSttProvider: (provider: 'browser' | 'server' | 'wasm') => {
                    set({ sttProvider: provider });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sttProvider', provider);
                    }
                    updateDesktopSettings({ sttProvider: provider }).catch(() => {});
                },

                setSttServerUrl: (url: string) => {
                    set({ sttServerUrl: url });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sttServerUrl', url);
                    }
                    updateDesktopSettings({ sttServerUrl: url }).catch(() => {});
                },

                setSttApiKey: (apiKey: string) => {
                    set({ sttApiKey: apiKey });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sttApiKey', apiKey);
                    }
                },

                setSttModel: (model: string) => {
                    set({ sttModel: model });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sttModel', model);
                    }
                    updateDesktopSettings({ sttModel: model }).catch(() => {});
                },

                setWasmSttModel: (model: string) => {
                    set({ wasmSttModel: model });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('wasmSttModel', model);
                    }
                    updateDesktopSettings({ wasmSttModel: model }).catch(() => {});
                },

                setSttLanguage: (lang: string) => {
                    set({ sttLanguage: lang });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sttLanguage', lang);
                    }
                    updateDesktopSettings({ sttLanguage: lang }).catch(() => {});
                },

                setSttSilenceThresholdDb: (db: number) => {
                    set({ sttSilenceThresholdDb: db });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sttSilenceThresholdDb', String(db));
                    }
                    updateDesktopSettings({ sttSilenceThresholdDb: db }).catch(() => {});
                },

                setSttSilenceHoldMs: (ms: number) => {
                    set({ sttSilenceHoldMs: ms });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sttSilenceHoldMs', String(ms));
                    }
                    updateDesktopSettings({ sttSilenceHoldMs: ms }).catch(() => {});
                },

                setSttTranscribeOnStop: (enabled: boolean) => {
                    set({ sttTranscribeOnStop: enabled });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('sttTranscribeOnStop', String(enabled));
                    }
                    updateDesktopSettings({ sttTranscribeOnStop: enabled }).catch(() => {});
                },

                setShowMessageTTSButtons: (show: boolean) => {
                    set({ showMessageTTSButtons: show });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('showMessageTTSButtons', String(show));
                    }
                },

                setTtsInputMode: (mode: 'sanitized' | 'raw') => {
                    set({ ttsInputMode: mode });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('ttsInputMode', mode);
                    }
                },

                setVoiceModeEnabled: (enabled: boolean) => {
                    set({ voiceModeEnabled: enabled });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('voiceModeEnabled', String(enabled));
                    }
                },

                setSummarizeMessageTTS: (enabled: boolean) => {
                    set({ summarizeMessageTTS: enabled });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('summarizeMessageTTS', String(enabled));
                    }
                },

                setSummarizeVoiceConversation: (enabled: boolean) => {
                    set({ summarizeVoiceConversation: enabled });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('summarizeVoiceConversation', String(enabled));
                    }
                },

                setSummarizeCharacterThreshold: (threshold: number) => {
                    const clamped = Math.max(50, Math.min(2000, threshold));
                    set({ summarizeCharacterThreshold: clamped });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('summarizeCharacterThreshold', String(clamped));
                    }
                },

                setSummarizeMaxLength: (maxLength: number) => {
                    const clamped = Math.max(50, Math.min(2000, maxLength));
                    set({ summarizeMaxLength: clamped });
                    if (typeof window !== 'undefined') {
                        localStorage.setItem('summarizeMaxLength', String(clamped));
                    }
                },

                getConnectionState: (serverId?: string | null) => {
                    return getConfigConnectionState(get(), serverId);
                },

                setConnectionState: (serverId, patch) => {
                    const normalizedServerId = normalizeConfigServerId(serverId);
                    set((state) => {
                        const previous = getConfigConnectionState(state, normalizedServerId);
                        const next: ConfigConnectionState = {
                            ...previous,
                            ...patch,
                        };
                        if (connectionStatesEqual(previous, next)) {
                            return state;
                        }

                        if (normalizedServerId === DEFAULT_SERVER_ID) {
                            return {
                                isConnected: next.isConnected,
                                hasEverConnected: next.hasEverConnected,
                                connectionPhase: next.connectionPhase,
                                lastDisconnectReason: next.lastDisconnectReason,
                            };
                        }

                        return {
                            connectionByServerId: {
                                ...state.connectionByServerId,
                                [normalizedServerId]: next,
                            },
                        };
                    });
                },

                probeConnection: async (options?: { timeoutMs?: number }) => {
                    const isHealthy = await probeOpenCodeHealth(options?.timeoutMs);
                    if (isHealthy) {
                        set({ isConnected: true, hasEverConnected: true, connectionPhase: "connected" });
                        return true;
                    }

                    const state = get();
                    if (state.isConnected) {
                        return true;
                    }

                    set({
                        isConnected: false,
                        connectionPhase: state.hasEverConnected ? "reconnecting" : "connecting",
                        lastDisconnectReason: 'health_probe_unhealthy',
                    });
                    return false;
                },

                checkConnection: async () => {
                    markStartupTrace('checkConnection:start');
                    const maxAttempts = 5;
                    let attempt = 0;
                    let lastError: unknown = null;

                    while (attempt < maxAttempts) {
                        let isHealthy = false;
                        try {
                            markStartupTrace('checkConnection:attempt', { attempt: attempt + 1 });
                            isHealthy = await measureStartupTrace(
                                'checkConnection:health',
                                () => import('@/lib/opencode/client')
                                    .then(({ opencodeClient }) => opencodeClient.checkHealth()),
                                { attempt: attempt + 1 },
                            );
                        } catch (error) {
                            lastError = error;
                        }

                        if (isHealthy) {
                            set({ isConnected: true, hasEverConnected: true, connectionPhase: "connected" });
                            markStartupTrace('checkConnection:end', { healthy: true, attempts: attempt + 1 });
                            return true;
                        }

                        const state = get();
                        if (state.isConnected) {
                            markStartupTrace('checkConnection:end', {
                                healthy: true,
                                attempts: attempt + 1,
                                source: 'event_stream',
                            });
                            return true;
                        }

                        attempt += 1;
                        if (attempt < maxAttempts) {
                            const delay = 400 * attempt;
                            await sleep(delay);
                        }
                    }

                    if (lastError) {
                        console.warn("[ConfigStore] Failed to reach OpenCode after retrying:", lastError);
                    }
                    const state = get();
                    if (state.isConnected) {
                        markStartupTrace('checkConnection:end', {
                            healthy: true,
                            attempts: maxAttempts,
                            source: 'event_stream',
                        });
                        return true;
                    }
                    set({
                        isConnected: false,
                        connectionPhase: state.hasEverConnected ? "reconnecting" : "connecting",
                        lastDisconnectReason: state.lastDisconnectReason
                            ?? (lastError ? 'health_check_failed' : 'health_check_unhealthy'),
                    });
                    markStartupTrace('checkConnection:end', { healthy: false, attempts: maxAttempts });
                    return false;
                },

                initializeApp: async () => {
                    if (_initializeAppInFlight) {
                        markStartupTrace('initializeApp:deduped');
                        return _initializeAppInFlight;
                    }

                    const run = (async () => {
                        try {
                            markStartupTrace('initializeApp:start');
                            const debug = streamDebugEnabled();
                            if (debug) console.log("Starting app initialization...");

                            const isConnected = await get().checkConnection();
                            if (debug) console.log("Connection check result:", isConnected);

                            if (!isConnected) {
                                if (debug) console.log("Server not connected");
                                // checkConnection already set lastDisconnectReason; do not overwrite.
                                set({
                                    isConnected: false,
                                    connectionPhase: get().hasEverConnected ? "reconnecting" : "connecting",
                                });
                                return;
                            }

                            if (debug) console.log("Skipping app init health probe...");
                            markStartupTrace('initApp:skipped', { reason: 'checkConnection already verified health' });

                            if (debug) console.log("Loading providers...");
                            if (debug) console.log("Loading agents...");
                            // Do not await OpenCode config.get — defaults arrive via bootstrap Phase 2 + emitSyncConfigChanged.
                            await Promise.all([
                                get().loadProviders({ source: 'initializeApp' }),
                                get().loadAgents({ source: 'initializeApp' }),
                            ]);

                            const synced = getSyncConfig(fromDirectoryKey(get().activeDirectoryKey) ?? undefined)
                                ?? getSyncConfig();
                            if (synced) {
                                get().applyOpenCodeConfigDefaults(
                                    fromDirectoryKey(get().activeDirectoryKey),
                                    'initializeApp:syncConfig',
                                    synced,
                                    serverIdFromDirectoryKey(get().activeDirectoryKey),
                                );
                            }

                            set({ isInitialized: true, isConnected: true, hasEverConnected: true, connectionPhase: "connected" });
                            // A plugin registers its agents while the server is already serving, so
                            // the load above can race it. Re-check once, after startup has settled.
                            setTimeout(() => void get().loadAgents({ source: 'startupAgentRecheck' }), 8_000);
                            markStartupTrace('initializeApp:end', {
                                providers: get().providers.length,
                                agents: get().agents.length,
                                hasSyncedConfig: !!synced,
                            });
                            if (debug) console.log("App initialized successfully");
                        } catch (error) {
                            console.error("Failed to initialize app:", error);
                            markStartupTrace('initializeApp:error', { error: error instanceof Error ? error.message : String(error) });
                            set({
                                isInitialized: false,
                                isConnected: false,
                                connectionPhase: get().hasEverConnected ? "reconnecting" : "connecting",
                                lastDisconnectReason: 'init_error',
                            });
                        }
                    })().finally(() => {
                        _initializeAppInFlight = null;
                    });

                    _initializeAppInFlight = run;
                    return run;
                },

                getCurrentProvider: () => {
                    const { providers, currentProviderId } = get();
                    return providers.find((p) => p.id === currentProviderId);
                },

                getCurrentModel: () => {
                    const provider = get().getCurrentProvider();
                    const { currentModelId } = get();
                    if (!provider) {
                        return undefined;
                    }
                    return provider.models.find((model) => model.id === currentModelId);
                },

                getCurrentAgent: () => {
                    const { agents, currentAgentName } = get();
                    if (!currentAgentName) return undefined;
                    return agents.find((a) => a.name === currentAgentName);
                },
                getModelMetadata: (providerId: string, modelId: string) => {
                    const key = buildModelMetadataKey(providerId, modelId);
                    if (!key) {
                        return undefined;
                    }
                    const { modelsMetadata, providers } = get();
                    const cached = modelsMetadata.get(key);
                    const model = providers
                        .find((p) => p.id === providerId)
                        ?.models.find((m) => m.id === modelId);

                    // The running OpenCode's limits win over the models.dev
                    // catalog: providers adjust them per auth (ChatGPT sign-in
                    // serves GPT models with a 400K window, the catalog says 1M+).
                    if (cached) {
                        const context = model?.limit?.context ?? 0;
                        if (!model || !(context > 0)) return cached;
                        return { ...cached, limit: { ...cached.limit, context, output: model.limit?.output } };
                    }

                    // Fallback: derive metadata from provider model data (covers custom providers not in models.dev)
                    return model ? deriveModelMetadata(providerId, model) : undefined;
                },
                getVisibleAgents: () => {
                    const { agents } = get();
                    return filterVisibleAgents(agents);
                },
                getAgentsForDirectory: (directory, serverId) => {
                    const state = get();
                    if (!directory && !serverId) {
                        return state.agents;
                    }

                    const directoryKey = toDirectoryKey(directory, serverId);
                    if (state.activeDirectoryKey === directoryKey) {
                        return state.agents;
                    }
                    return state.directoryScoped[directoryKey]?.agents ?? [];
                },
            }),
            {
                name: "config-store",
                storage: createDeferredSafeJSONStorage(),
                partialize: (state) => ({
                    activeDirectoryKey: state.activeDirectoryKey,
                    directoryScoped: Object.fromEntries(
                        Object.entries(state.directoryScoped).map(([directoryKey, snapshot]) => [
                            directoryKey,
                            {
                                ...snapshot,
                                selectedProviderId: sanitizePersistedProviderSelection(snapshot.selectedProviderId),
                            },
                        ]),
                    ),
                    currentProviderId: state.currentProviderId,
                    currentModelId: state.currentModelId,
                    currentVariant: state.currentVariant,
                    currentAgentName: state.currentAgentName,
                    selectedProviderId: sanitizePersistedProviderSelection(state.selectedProviderId),
                    agentModelSelections: state.agentModelSelections,
                    defaultProviders: state.defaultProviders,
                    selectionSource: state.selectionSource,
                    opencodeDefaultAgent: state.opencodeDefaultAgent,
                    opencodeDefaultModel: state.opencodeDefaultModel,
                    settingsDefaultModel: state.settingsDefaultModel,
                    settingsDefaultVariant: state.settingsDefaultVariant,
                    settingsDefaultAgent: state.settingsDefaultAgent,
                    settingsAutoCreateWorktree: state.settingsAutoCreateWorktree,
                    settingsGitmojiEnabled: state.settingsGitmojiEnabled,
                    settingsDefaultFileViewerPreview: state.settingsDefaultFileViewerPreview,
                    settingsZenModel: state.settingsZenModel,
                    settingsMessageStreamTransport: state.settingsMessageStreamTransport,
                    speechRate: state.speechRate,
                    speechPitch: state.speechPitch,
                    speechVolume: state.speechVolume,
                }),
             },
         ),
    ),
);

if (typeof window !== "undefined") {
    window.__zustand_config_store__ = useConfigStore;
}

let unsubscribeConfigStoreChanges: (() => void) | null = null;

if (!unsubscribeConfigStoreChanges) {
    unsubscribeConfigStoreChanges = subscribeToConfigChanges(async (event) => {
        const tasks: Promise<void>[] = [];

        if (scopeMatches(event, "agents")) {
            const { loadAgents } = useConfigStore.getState();
            tasks.push(loadAgents({ source: 'configChange:agents' }).then(() => {}));
        }

        if (scopeMatches(event, "providers")) {
            const { loadProviders } = useConfigStore.getState();
            tasks.push(loadProviders({ source: 'configChange:providers' }));
        }

        if (tasks.length > 0) {
            await Promise.all(tasks);
        }
    });
}

let unsubscribeConfigStoreDirectoryChanges: (() => void) | null = null;

let unsubscribeConfigStoreSyncConfigChanges: (() => void) | null = null;

if (!unsubscribeConfigStoreSyncConfigChanges) {
    unsubscribeConfigStoreSyncConfigChanges = subscribeToSyncConfigChanges((directory, config) => {
        const projectServerId = resolveProjectServerIdForDirectory(directory);
        useConfigStore.getState().applyOpenCodeConfigDefaults(directory, 'syncConfig', config, projectServerId);
    });
}

if (typeof window !== "undefined" && !unsubscribeConfigStoreDirectoryChanges) {
    unsubscribeConfigStoreDirectoryChanges = useDirectoryStore.subscribe((state, prevState) => {
        const projectServerId = resolveProjectServerIdForDirectory(state.currentDirectory);
        const currentSessionId = useSessionUIStore.getState().currentSessionId;
        const serverId = projectServerId
            ?? (currentSessionId
                ? serverRegistry.getServerForSession(currentSessionId)
                : serverIdFromDirectoryKey(useConfigStore.getState().activeDirectoryKey));
        const nextKey = toDirectoryKey(state.currentDirectory, serverId);
        const prevKey = toDirectoryKey(prevState.currentDirectory, serverId);
        if (nextKey === prevKey) {
            return;
        }

        markStartupTrace('directoryStore:changed', { previous: prevKey, next: nextKey, serverId, projectServerId });
        void useConfigStore.getState().activateDirectory(state.currentDirectory, { serverId });
    });
}
