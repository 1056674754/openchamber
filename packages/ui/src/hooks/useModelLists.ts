import React from 'react';
import { selectProvidersForDirectory, useConfigStore } from '@/stores/useConfigStore';
import { useUIStore } from '@/stores/useUIStore';
import type { ModelPickerProvider, ProviderModel } from '@/components/model-picker/ModelPickerList';

type ProviderWithModelList = ModelPickerProvider & { models: ProviderModel[] };
type ModelIdentity = { providerID: string; modelID: string };

export interface ModelListItem {
  provider: ProviderWithModelList;
  model: ProviderModel;
  providerID: string;
  modelID: string;
}

export interface ModelListsResult {
  favoriteModelsList: ModelListItem[];
  recentModelsList: ModelListItem[];
  hiddenModels: ModelIdentity[];
}

const isProviderWithModelList = (provider: ModelPickerProvider): provider is ProviderWithModelList => Array.isArray(provider.models);

const modelIdentityKey = ({ providerID, modelID }: ModelIdentity): string => `${providerID}:${modelID}`;

export const buildModelLists = ({
  providers,
  favoriteModels,
  recentModels,
  hiddenModels,
}: {
  providers: readonly ProviderWithModelList[];
  favoriteModels: readonly ModelIdentity[];
  recentModels: readonly ModelIdentity[];
  hiddenModels: readonly ModelIdentity[];
}): ModelListsResult => {
  const hiddenModelKeys = new Set(hiddenModels.map(modelIdentityKey));
  const isHidden = ({ providerID, modelID }: ModelIdentity) => hiddenModelKeys.has(modelIdentityKey({ providerID, modelID }));

  const favoriteModelsList = favoriteModels
    .map(({ providerID, modelID }) => {
      const provider = providers.find((p) => p.id === providerID);
      if (!provider) return null;
      const model = provider.models.find((m: ProviderModel) => m.id === modelID);
      if (!model) return null;
      if (isHidden({ providerID, modelID })) return null;
      return { provider, model, providerID, modelID };
    })
    .filter((item): item is ModelListItem => item !== null);

  const favoriteModelKeys = new Set(favoriteModels.map(modelIdentityKey));
  const recentModelsList = recentModels
    .map(({ providerID, modelID }) => {
      const provider = providers.find((p) => p.id === providerID);
      if (!provider) return null;
      const model = provider.models.find((m: ProviderModel) => m.id === modelID);
      if (!model) return null;
      if (isHidden({ providerID, modelID })) return null;
      return { provider, model, providerID, modelID };
    })
    .filter((item): item is ModelListItem => item !== null)
    .filter((item) => !favoriteModelKeys.has(modelIdentityKey(item)));

  return { favoriteModelsList, recentModelsList, hiddenModels: [...hiddenModels] };
};

// `directory` resolves favorites and recents against that directory's scoped
// catalog (a settings page editing another project), not the active one.
export const useModelLists = (directory?: string) => {
  const providers = useConfigStore((state) => (directory === undefined
    ? state.providers
    : selectProvidersForDirectory(state, directory)));
  const favoriteModels = useUIStore((state) => state.favoriteModels);
  const recentModels = useUIStore((state) => state.recentModels);
  const hiddenModels = useUIStore((state) => state.hiddenModels);
  const providersWithModelLists = React.useMemo(() => providers.filter(isProviderWithModelList), [providers]);

  return React.useMemo(() => buildModelLists({
    providers: providersWithModelLists,
    favoriteModels,
    recentModels,
    hiddenModels,
  }), [favoriteModels, hiddenModels, providersWithModelLists, recentModels]);
};
