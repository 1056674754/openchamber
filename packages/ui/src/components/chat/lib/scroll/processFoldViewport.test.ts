import { describe, expect, test } from 'bun:test';

import {
    captureProcessFoldViewportAnchor,
    restoreProcessFoldViewportAnchor,
} from './processFoldViewport';

describe('process fold viewport anchoring', () => {
    test('compensates scrollTop when the clicked toggle moves', () => {
        let top = 240;
        const container = {
            isConnected: true,
            scrollTop: 600,
        } as HTMLElement;
        const element = {
            isConnected: true,
            getBoundingClientRect: () => ({ top }),
        } as unknown as HTMLElement;
        const anchor = captureProcessFoldViewportAnchor(container, element);

        top = 410;

        expect(restoreProcessFoldViewportAnchor(anchor)).toBe(true);
        expect(container.scrollTop).toBe(770);
    });

    test('does not adjust a detached toggle', () => {
        const container = {
            isConnected: true,
            scrollTop: 600,
        } as HTMLElement;
        const element = {
            isConnected: false,
            getBoundingClientRect: () => ({ top: 400 }),
        } as unknown as HTMLElement;
        const anchor = captureProcessFoldViewportAnchor(container, element);

        expect(restoreProcessFoldViewportAnchor(anchor)).toBe(false);
        expect(container.scrollTop).toBe(600);
    });
});
