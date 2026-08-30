export const ADD_PROVIDER_SELECTION_ID = '__add_provider__';

export const resolveSettingsProviderSelection = (
    currentSelection: string | undefined,
    preferredProviderId: string | undefined,
    firstProviderId: string | undefined,
): string => {
    return currentSelection || preferredProviderId || firstProviderId || '';
};

export const sanitizePersistedProviderSelection = (providerId: string | undefined): string => {
    return providerId === ADD_PROVIDER_SELECTION_ID ? '' : (providerId ?? '');
};
