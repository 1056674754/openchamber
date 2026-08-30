import { describe, expect, test } from 'bun:test';

import {
    ADD_PROVIDER_SELECTION_ID,
    resolveSettingsProviderSelection,
    sanitizePersistedProviderSelection,
} from './configProviderSelection';

describe('provider settings selection', () => {
    test('keeps the user-owned selection across provider refreshes', () => {
        expect(resolveSettingsProviderSelection(ADD_PROVIDER_SELECTION_ID, 'openai', 'anthropic')).toBe(ADD_PROVIDER_SELECTION_ID);
        expect(resolveSettingsProviderSelection('plugin-provider', 'openai', 'anthropic')).toBe('plugin-provider');
        expect(resolveSettingsProviderSelection('', 'openai', 'anthropic')).toBe('openai');
        expect(resolveSettingsProviderSelection('', undefined, 'anthropic')).toBe('anthropic');
    });

    test('does not persist the transient add-provider sentinel', () => {
        expect(sanitizePersistedProviderSelection(ADD_PROVIDER_SELECTION_ID)).toBe('');
        expect(sanitizePersistedProviderSelection('openai')).toBe('openai');
        expect(sanitizePersistedProviderSelection(undefined)).toBe('');
    });
});
