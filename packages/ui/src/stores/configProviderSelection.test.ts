import { describe, expect, test } from 'bun:test';

import {
    ADD_PROVIDER_SELECTION_ID,
    preserveAddProviderSelection,
    sanitizePersistedProviderSelection,
} from './configProviderSelection';

describe('provider settings selection', () => {
    test('keeps the add-provider flow selected across background defaults', () => {
        expect(preserveAddProviderSelection(ADD_PROVIDER_SELECTION_ID, 'openai')).toBe(ADD_PROVIDER_SELECTION_ID);
        expect(preserveAddProviderSelection('anthropic', 'openai')).toBe('openai');
    });

    test('does not persist the transient add-provider sentinel', () => {
        expect(sanitizePersistedProviderSelection(ADD_PROVIDER_SELECTION_ID)).toBe('');
        expect(sanitizePersistedProviderSelection('openai')).toBe('openai');
        expect(sanitizePersistedProviderSelection(undefined)).toBe('');
    });
});
