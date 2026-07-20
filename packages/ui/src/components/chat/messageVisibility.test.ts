import { describe, expect, test } from 'bun:test';

import { shouldHideAssistantMessageShell } from './messageVisibility';

describe('assistant message visibility', () => {
    test('hides metadata-only assistant messages until content or an error is materialized', () => {
        expect(shouldHideAssistantMessageShell({ hasRenderableContent: false, hasError: false })).toBe(true);
        expect(shouldHideAssistantMessageShell({ hasRenderableContent: true, hasError: false })).toBe(false);
        expect(shouldHideAssistantMessageShell({ hasRenderableContent: false, hasError: true })).toBe(false);
        expect(shouldHideAssistantMessageShell({
            hasRenderableContent: false,
            hasError: false,
            isDirectiveBanner: true,
        })).toBe(false);
    });
});
