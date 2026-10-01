import { describe, expect, test } from 'bun:test';
import { Window } from 'happy-dom';

import { cloneMessageImageExportSource, MESSAGE_IMAGE_EXPORT_EXCLUDE_ATTRIBUTE } from './imageExport';

Object.assign(globalThis, { document: new Window().document });

describe('message image export', () => {
    test('omits marked decoration from the clone without removing content or mutating the source', () => {
        const source = document.createElement('div');
        source.innerHTML = `
            <span ${MESSAGE_IMAGE_EXPORT_EXCLUDE_ATTRIBUTE}="true">
                <img src="https://icons.duckduckgo.com/ip3/example.com.ico" alt="">
            </span>
            <p>Message content</p>
            <img src="data:image/png;base64,content" alt="Message image">
        `;

        const clone = cloneMessageImageExportSource(source);

        expect(Boolean(clone.querySelector(`[${MESSAGE_IMAGE_EXPORT_EXCLUDE_ATTRIBUTE}="true"]`))).toBe(false);
        expect(Boolean(clone.querySelector('img[src^="https://icons.duckduckgo.com/"]'))).toBe(false);
        expect(clone.textContent).toContain('Message content');
        expect(Boolean(clone.querySelector('img[alt="Message image"]'))).toBe(true);
        expect(Boolean(source.querySelector(`[${MESSAGE_IMAGE_EXPORT_EXCLUDE_ATTRIBUTE}="true"]`))).toBe(true);
    });
});
