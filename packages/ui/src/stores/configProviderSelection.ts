export const ADD_PROVIDER_SELECTION_ID = '__add_provider__';

export const preserveAddProviderSelection = (
    currentSelection: string | undefined,
    nextProviderId: string,
): string => {
    return currentSelection === ADD_PROVIDER_SELECTION_ID
        ? ADD_PROVIDER_SELECTION_ID
        : nextProviderId;
};

export const sanitizePersistedProviderSelection = (providerId: string | undefined): string => {
    return providerId === ADD_PROVIDER_SELECTION_ID ? '' : (providerId ?? '');
};
