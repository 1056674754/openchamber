import type { StreamPhase } from '../types';

export const shouldMaterializeTaskDetails = ({
    isExpanded,
    streamPhase,
}: {
    isExpanded: boolean;
    streamPhase: StreamPhase;
}): boolean => isExpanded || streamPhase !== 'completed';
