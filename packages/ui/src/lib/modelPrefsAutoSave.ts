import { useUIStore } from '@/stores/useUIStore';
import { updateDesktopSettings } from '@/lib/persistence';
import { isVSCodeRuntime } from '@/lib/desktop';
import {
  areModelPickerLayoutMapsEqual,
  type ModelPickerLayoutByServerId,
} from '@/lib/modelPickerLayout';

type ModelRef = { providerID: string; modelID: string };
type ModelPrefsPayload = {
  favoriteModels: ModelRef[];
  hiddenModels: ModelRef[];
  collapsedModelProviders: string[];
  modelPickerLayoutByServerId: ModelPickerLayoutByServerId;
  recentModels: ModelRef[];
  recentAgents: string[];
  recentEfforts: Record<string, string[]>;
};

const refsEqual = (a: ModelRef[], b: ModelRef[]): boolean => {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) {
    if (a[i]?.providerID !== b[i]?.providerID) return false;
    if (a[i]?.modelID !== b[i]?.modelID) return false;
  }
  return true;
};

const stringsEqual = (a: string[], b: string[]): boolean => (
  a === b || (a.length === b.length && a.every((value, index) => value === b[index]))
);

const recentEffortsEqual = (a: Record<string, string[]>, b: Record<string, string[]>): boolean => {
  if (a === b) return true;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length
    && keys.every((key) => Array.isArray(b[key]) && stringsEqual(a[key], b[key]));
};

const cloneLayoutMap = (layoutByServerId: ModelPickerLayoutByServerId): ModelPickerLayoutByServerId => (
  Object.fromEntries(
    Object.entries(layoutByServerId).map(([serverId, layout]) => [
      serverId,
      {
        providerOrder: layout.providerOrder.slice(),
        collapsedProviders: layout.collapsedProviders.slice(),
      },
    ]),
  )
);

const snapshotModelPrefs = (): ModelPrefsPayload => {
  const state = useUIStore.getState();
  return {
    favoriteModels: state.favoriteModels,
    hiddenModels: state.hiddenModels,
    collapsedModelProviders: [],
    modelPickerLayoutByServerId: state.modelPickerLayoutByServerId,
    recentModels: state.recentModels,
    recentAgents: state.recentAgents,
    recentEfforts: state.recentEfforts,
  };
};

const modelPrefsEqual = (a: ModelPrefsPayload, b: ModelPrefsPayload): boolean => (
  refsEqual(a.favoriteModels, b.favoriteModels)
  && refsEqual(a.hiddenModels, b.hiddenModels)
  && stringsEqual(a.collapsedModelProviders, b.collapsedModelProviders)
  && areModelPickerLayoutMapsEqual(a.modelPickerLayoutByServerId, b.modelPickerLayoutByServerId)
  && refsEqual(a.recentModels, b.recentModels)
  && stringsEqual(a.recentAgents, b.recentAgents)
  && recentEffortsEqual(a.recentEfforts, b.recentEfforts)
);

const cloneModelPrefs = (prefs: ModelPrefsPayload): ModelPrefsPayload => ({
  favoriteModels: prefs.favoriteModels.slice(),
  hiddenModels: prefs.hiddenModels.slice(),
  collapsedModelProviders: prefs.collapsedModelProviders.slice(),
  modelPickerLayoutByServerId: cloneLayoutMap(prefs.modelPickerLayoutByServerId),
  recentModels: prefs.recentModels.slice(),
  recentAgents: prefs.recentAgents.slice(),
  recentEfforts: Object.fromEntries(
    Object.entries(prefs.recentEfforts).map(([key, variants]) => [key, variants.slice()]),
  ),
});

export const startModelPrefsAutoSave = () => {
  if (typeof window === 'undefined') {
    return () => {};
  }
  if (isVSCodeRuntime()) {
    return () => {};
  }

  let timer: number | null = null;
  let lastSent: ModelPrefsPayload | null = null;
  let didSkipInitial = false;

  const flush = () => {
    timer = null;
    const payload = snapshotModelPrefs();

    if (lastSent && modelPrefsEqual(lastSent, payload)) {
      return;
    }

    lastSent = cloneModelPrefs(payload);

    void updateDesktopSettings(payload).catch(() => {});
  };

  const schedule = () => {
    if (!didSkipInitial) {
      didSkipInitial = true;
      return;
    }
    if (timer !== null) {
      window.clearTimeout(timer);
    }
    timer = window.setTimeout(flush, 1200);
  };

  const unsubscribe = useUIStore.subscribe((state, prevState) => {
    const next: ModelPrefsPayload = {
      favoriteModels: state.favoriteModels,
      hiddenModels: state.hiddenModels,
      collapsedModelProviders: [],
      modelPickerLayoutByServerId: state.modelPickerLayoutByServerId,
      recentModels: state.recentModels,
      recentAgents: state.recentAgents,
      recentEfforts: state.recentEfforts,
    };
    const prev: ModelPrefsPayload = {
      favoriteModels: prevState.favoriteModels,
      hiddenModels: prevState.hiddenModels,
      collapsedModelProviders: [],
      modelPickerLayoutByServerId: prevState.modelPickerLayoutByServerId,
      recentModels: prevState.recentModels,
      recentAgents: prevState.recentAgents,
      recentEfforts: prevState.recentEfforts,
    };
    if (modelPrefsEqual(next, prev)) {
      return;
    }
    schedule();
  });

  return () => {
    unsubscribe();
    if (timer !== null) {
      window.clearTimeout(timer);
    }
  };
};
