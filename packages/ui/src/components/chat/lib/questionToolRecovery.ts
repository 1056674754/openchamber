import type { ToolPart as ToolPartType } from '@opencode-ai/sdk/v2';
import type { QuestionInfo, QuestionOption, QuestionRequest } from '@/types/question';

type RecoverQuestionRequestInput = {
    readonly part: ToolPartType;
    readonly messageID?: string;
    readonly sessionID?: string;
    readonly normalizedToolName?: string;
};

const RECOVERED_REQUEST_PREFIX = 'recovered-question';
const ANSWERED_OUTPUT_PREFIX = 'User has answered your questions:';
const CLOSED_ERROR_MARKERS = [
    'The user dismissed this question',
    'QuestionRejectedError',
    'question rejected',
    'aborted',
    'cancelled',
    'canceled',
    'dismissed',
];
const TERMINAL_TOOL_STATUSES = new Set(['completed', 'error', 'aborted', 'failed', 'timeout', 'cancelled']);

const getValue = (value: unknown, key: string): unknown => {
    if (typeof value !== 'object' || value === null) return undefined;
    return Reflect.get(value, key);
};

const getStringValue = (value: unknown, key: string): string | undefined => {
    const raw = getValue(value, key);
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
};

const getBooleanValue = (value: unknown, key: string): boolean | undefined => {
    const raw = getValue(value, key);
    return typeof raw === 'boolean' ? raw : undefined;
};

const parseQuestionOption = (value: unknown): QuestionOption | null => {
    const label = getStringValue(value, 'label');
    if (!label) return null;
    return {
        label,
        description: getStringValue(value, 'description') ?? '',
    };
};

const parseQuestionInfo = (value: unknown): QuestionInfo | null => {
    const question = getStringValue(value, 'question');
    if (!question) return null;

    const rawOptions = getValue(value, 'options');
    const options = Array.isArray(rawOptions)
        ? rawOptions
            .map(parseQuestionOption)
            .filter((option): option is QuestionOption => option !== null)
        : [];

    return {
        question,
        header: getStringValue(value, 'header') ?? '',
        options,
        multiple: getBooleanValue(value, 'multiple') ?? false,
    };
};

const parseQuestionInfos = (value: unknown): QuestionInfo[] => {
    if (!Array.isArray(value)) return [];
    return value
        .map(parseQuestionInfo)
        .filter((question): question is QuestionInfo => question !== null);
};

const hasQuestionAnswer = (part: ToolPartType): boolean => {
    const metadata = getValue(part.state, 'metadata');
    if (Array.isArray(getValue(metadata, 'answers'))) return true;

    const output = getStringValue(part.state, 'output');
    return Boolean(output?.startsWith(ANSWERED_OUTPUT_PREFIX));
};

const isQuestionClosedByUser = (part: ToolPartType): boolean => {
    const error = getStringValue(part.state, 'error');
    if (!error) return false;
    const lowerError = error.toLowerCase();
    return CLOSED_ERROR_MARKERS.some((marker) => lowerError.includes(marker.toLowerCase()));
};

const isToolPartTerminatedWithoutAnswer = (part: ToolPartType): boolean => {
    if (hasQuestionAnswer(part)) return false;
    const status = getStringValue(part.state, 'status');
    return status !== undefined && TERMINAL_TOOL_STATUSES.has(status);
};

const questionSignature = (questions: readonly QuestionInfo[]): string => {
    return JSON.stringify(questions.map((question) => ({
        header: question.header,
        multiple: Boolean(question.multiple),
        options: question.options.map((option) => ({
            description: option.description,
            label: option.label,
        })),
        question: question.question,
    })));
};

export const recoverQuestionRequestFromToolPart = ({
    part,
    messageID,
    sessionID,
    normalizedToolName,
}: RecoverQuestionRequestInput): QuestionRequest | null => {
    if ((normalizedToolName ?? part.tool) !== 'question') return null;
    if (hasQuestionAnswer(part) || isQuestionClosedByUser(part) || isToolPartTerminatedWithoutAnswer(part)) return null;

    const requestSessionID = sessionID ?? part.sessionID;
    const requestMessageID = messageID ?? part.messageID;
    const requestCallID = part.callID || part.id;
    if (!requestSessionID || !requestMessageID || !requestCallID) return null;

    const questions = parseQuestionInfos(getValue(part.state.input, 'questions'));
    if (questions.length === 0) return null;

    return {
        id: `${RECOVERED_REQUEST_PREFIX}:${requestMessageID}:${requestCallID}`,
        sessionID: requestSessionID,
        questions,
        tool: {
            messageID: requestMessageID,
            callID: requestCallID,
        },
    };
};

export const findPendingQuestionRequestForRecoveredTool = (
    recovered: QuestionRequest,
    pendingRequests: readonly QuestionRequest[],
): QuestionRequest | null => {
    const recoveredTool = recovered.tool;
    if (recoveredTool) {
        const toolMatch = pendingRequests.find((request) => (
            request.sessionID === recovered.sessionID
            && request.tool?.messageID === recoveredTool.messageID
            && request.tool?.callID === recoveredTool.callID
        ));
        if (toolMatch) return toolMatch;
    }

    const recoveredSignature = questionSignature(recovered.questions);
    const contentMatches = pendingRequests.filter((request) => (
        request.sessionID === recovered.sessionID
        && questionSignature(request.questions) === recoveredSignature
    ));

    return contentMatches.length === 1 ? contentMatches[0] : null;
};
