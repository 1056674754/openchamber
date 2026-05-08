import type { Message, Part } from '@opencode-ai/sdk/v2';

export interface ChatMessageEntry {
    info: Message;
    parts: Part[];
}

export type TurnActivityKind = 'tool' | 'reasoning' | 'justification';

export interface TurnMessageRecord {
    messageId: string;
    role: string;
    parentMessageId?: string;
    message: ChatMessageEntry;
    order: number;
}

export interface TurnPartRecord {
    id: string;
    turnId: string;
    messageId: string;
    part: Part;
    partIndex: number;
    endedAt?: number;
}

export interface TurnActivityRecord extends TurnPartRecord {
    kind: TurnActivityKind;
}

export interface TurnDiffStats {
    additions: number;
    deletions: number;
    files: number;
}

export interface TurnActivityGroup {
    id: string;
    anchorMessageId: string;
    afterToolPartId: string | null;
    parts: TurnActivityRecord[];
}

export interface TurnSummaryRecord {
    text?: string;
    sourceMessageId?: string;
    sourcePartId?: string;
}

export interface TurnStreamState {
    isStreaming: boolean;
    isRetrying: boolean;
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
}

export interface TurnRecord {
    turnId: string;
    userMessageId: string;
    userMessage: ChatMessageEntry;
    headerMessageId?: string;
    messages: TurnMessageRecord[];
    assistantMessageIds: string[];
    assistantMessages: ChatMessageEntry[];
    // [sscity-mod] True when the "user" message that created this turn is
    // actually a system directive (OMO TODO continuation, atlas <system-reminder>,
    // etc.) rather than a real human-authored message. Directive turns keep
    // their assistant responses grouped correctly via parentID, but do NOT
    // render a sticky user header — the directive is shown as an inline banner.
    isDirectiveTurn: boolean;
    activityParts: TurnActivityRecord[];
    activitySegments: TurnActivityGroup[];
    summary: TurnSummaryRecord;
    summaryText?: string;
    hasTools: boolean;
    hasReasoning: boolean;
    diffStats?: TurnDiffStats;
    stream: TurnStreamState;
    startedAt?: number;
    completedAt?: number;
    durationMs?: number;
}

export interface TurnMessageMeta {
    turnId: string;
    messageId: string;
    userMessageId: string;
    isUserMessage: boolean;
    isAssistantMessage: boolean;
    isFirstAssistantInTurn: boolean;
    isLastAssistantInTurn: boolean;
    headerMessageId?: string;
}

export interface TurnIndexes {
    turnById: Map<string, TurnRecord>;
    messageToTurnId: Map<string, string>;
    messageMetaById: Map<string, TurnMessageMeta>;
}

export interface TurnProjectionResult {
    turns: TurnRecord[];
    indexes: TurnIndexes;
    lastTurnId: string | null;
    lastTurnMessageIds: Set<string>;
    ungroupedMessageIds: Set<string>;
}

export type Turn = Pick<TurnRecord, 'turnId' | 'userMessage' | 'assistantMessages' | 'isDirectiveTurn'>;

export interface TurnGroupingContext {
    turnId: string;
    activityOwnerMessageId?: string | null;
    isFirstAssistantInTurn: boolean;
    isLastAssistantInTurn: boolean;
    isWorking: boolean;
    hasTools: boolean;
    hasReasoning: boolean;
    summaryBody?: string;
    activityParts?: TurnActivityRecord[];
    activityGroupSegments?: TurnActivityGroup[];
    headerMessageId?: string;
    diffStats?: TurnDiffStats;
    userMessageCreatedAt?: number;
    userMessageVariant?: string;
    isGroupExpanded?: boolean;
    toggleGroup?: () => void;
    absorbedToolPartIds?: Set<string>;
    extraTrailingTools?: Part[];
}
