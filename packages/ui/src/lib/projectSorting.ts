export type ProjectSortOrder = 'manual' | 'a-z' | 'z-a' | 'date-added' | 'recent';

type SortableProject = {
    id: string;
    path: string;
    label?: string;
    addedAt?: number;
    lastOpenedAt?: number;
};

export const sortProjectsByOrder = <T extends SortableProject>(
    projects: readonly T[],
    order: ProjectSortOrder,
): T[] => {
    const sorted = [...projects];

    switch (order) {
        case 'a-z':
            return sorted.sort((left, right) => (
                (left.label || left.path).localeCompare(right.label || right.path, undefined, { sensitivity: 'base' })
            ));
        case 'z-a':
            return sorted.sort((left, right) => (
                (right.label || right.path).localeCompare(left.label || left.path, undefined, { sensitivity: 'base' })
            ));
        case 'date-added':
            return sorted.sort((left, right) => (right.addedAt ?? 0) - (left.addedAt ?? 0));
        case 'recent':
            return sorted.sort((left, right) => (right.lastOpenedAt ?? 0) - (left.lastOpenedAt ?? 0));
        case 'manual':
            return sorted;
    }
};
