/// <reference types="vite/client" />

interface Window {
    __openchamberRemoteRpcDebug?: {
        entries: Array<{
            phase: "request" | "response" | "abort" | "error";
            at: string;
            id: string;
            target: "local" | "remote";
            instanceId?: string;
            method: string;
            path: string;
            elapsedMs?: number;
            status?: number;
            statusText?: string;
            requestBodyBytes?: number;
            requestBodyPreview?: string;
            requestBodyTruncated?: boolean;
            stack?: string;
            responseBodyBytes?: number;
            responseBodyPreview?: string;
            responseBodyTruncated?: boolean;
            error?: string;
            beforeSend?: boolean;
        }>;
        enabled: () => boolean;
        bodyEnabled: () => boolean;
        enable: () => void;
        disable: () => void;
        enableBody: () => void;
        disableBody: () => void;
        clear: () => void;
        snapshot: (options?: { pathIncludes?: string; status?: number; phase?: "request" | "response" | "abort" | "error" }) => unknown[];
        pending: () => Array<{
            id: string;
            target: "local" | "remote";
            instanceId?: string;
            method: string;
            path: string;
            elapsedMs: number;
        }>;
    };
    __openchamberServerRegistryDebug?: {
        enable: () => void;
        disable: () => void;
        enabled: () => boolean;
        clear: () => void;
        index: () => Array<{ sessionId: string; serverId: string }>;
        lookup: (sessionId: string) => string | undefined;
        trace: (sessionId?: string, limit?: number) => Array<{
            at: string;
            sessionId: string;
            previous?: string;
            next?: string;
            stack?: string;
        }>;
    };
    __opencodeDebug?: {
        getLastAssistantMessage: () => unknown;
        getAllMessages: (truncate?: boolean) => unknown[];
        truncateMessages: (messages: unknown[]) => unknown[];
        getAppStatus: () => Promise<unknown>;
        checkLastMessage: () => boolean;
        findEmptyMessages: () => unknown[];
        showRetryHelp: () => void;
        getStreamingState: () => unknown;
        analyzeMessageCompletionConsistency: (options?: unknown) => unknown;
        checkCompletionStatus: () => unknown;
    };
}
