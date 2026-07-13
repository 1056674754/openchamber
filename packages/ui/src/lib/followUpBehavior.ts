export const FOLLOW_UP_BEHAVIORS = ['steer', 'queue'] as const;

export type FollowUpBehavior = (typeof FOLLOW_UP_BEHAVIORS)[number];
export type FollowUpAction = 'normal' | FollowUpBehavior;

export const isFollowUpBehavior = (value: unknown): value is FollowUpBehavior => (
    value === 'steer' || value === 'queue'
);

export const resolvePersistedFollowUpBehavior = (
    value: unknown,
    legacyQueueModeEnabled: unknown,
): FollowUpBehavior => {
    if (isFollowUpBehavior(value)) {
        return value;
    }
    if (value === 'immediate') {
        return 'steer';
    }
    if (typeof legacyQueueModeEnabled === 'boolean') {
        return legacyQueueModeEnabled ? 'queue' : 'steer';
    }
    return 'steer';
};

export const resolveFollowUpAction = ({
    behavior,
    canQueue,
    alternate,
}: {
    readonly behavior: FollowUpBehavior;
    readonly canQueue: boolean;
    readonly alternate: boolean;
}): FollowUpAction => {
    if (!canQueue) {
        return 'normal';
    }
    if (alternate) {
        return behavior === 'queue' ? 'steer' : 'queue';
    }
    return behavior;
};
