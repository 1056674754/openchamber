import { describe, expect, test } from 'bun:test';

import {
    getTableColumnWidth,
    TABLE_COLUMN_MAX_WIDTH,
    TABLE_COLUMN_MIN_WIDTH,
} from './markdownTableLayout';

describe('markdownTableLayout', () => {
    test('clamps measured columns to the content-adaptive range', () => {
        expect(getTableColumnWidth(10)).toBe(TABLE_COLUMN_MIN_WIDTH);
        expect(getTableColumnWidth(120)).toBe(120);
        expect(getTableColumnWidth(87.4)).toBe(TABLE_COLUMN_MIN_WIDTH);
        expect(getTableColumnWidth(199.2)).toBe(200);
        expect(getTableColumnWidth(5_000)).toBe(TABLE_COLUMN_MAX_WIDTH);
    });
});
