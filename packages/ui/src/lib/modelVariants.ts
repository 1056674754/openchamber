import type { Provider } from '@opencode-ai/sdk/v2';

type ProviderModel = Provider['models'][string];

export const modelVariantNames = (model: ProviderModel | undefined): string[] => {
  if (!model) return [];
  const variants = (model as { variants?: object }).variants;
  return variants ? Object.keys(variants) : [];
};
