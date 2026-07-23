import { describe, expect, test } from 'bun:test';

import { sortProjectsByOrder } from './projectSorting';

const projects = [
    { id: 'b', path: '/work/beta', label: 'Beta', addedAt: 10, lastOpenedAt: 30 },
    { id: 'a', path: '/work/alpha', label: 'alpha', addedAt: 30, lastOpenedAt: 10 },
    { id: 'c', path: '/work/charlie', addedAt: 20, lastOpenedAt: 20 },
];

describe('sortProjectsByOrder', () => {
    test('preserves the stored order in manual mode', () => {
        expect(sortProjectsByOrder(projects, 'manual').map((project) => project.id)).toEqual(['b', 'a', 'c']);
    });

    test('sorts labels without mutating the source collection', () => {
        expect(sortProjectsByOrder(projects, 'a-z').map((project) => project.id)).toEqual(['c', 'a', 'b']);
        expect(sortProjectsByOrder(projects, 'z-a').map((project) => project.id)).toEqual(['b', 'a', 'c']);
        expect(projects.map((project) => project.id)).toEqual(['b', 'a', 'c']);
    });

    test('sorts by added and recently opened timestamps', () => {
        expect(sortProjectsByOrder(projects, 'date-added').map((project) => project.id)).toEqual(['a', 'c', 'b']);
        expect(sortProjectsByOrder(projects, 'recent').map((project) => project.id)).toEqual(['b', 'c', 'a']);
    });
});
