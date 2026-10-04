import type { Session } from "@opencode-ai/sdk/v2";
import { runBackgroundNetworkTask } from '@/lib/background-network';
import { retry } from "@/sync/retry";
import { unwrapSessionListRows } from "@/sync/session-list-bootstrap";
import { projectSession } from "@/lib/opencode/projection";
import type { SessionInfo } from "@opencode/client";
import { isChatDirectoryPath } from '@/lib/chatDirectories';

export type GlobalSessionRecord = Session & {
    project?: {
        id: string;
        name?: string;
        worktree?: string;
    } | null;
};

export const filterManagedChatsForRuntime = (sessions: Session[], vscode: boolean): Session[] => (
    vscode ? sessions.filter((session) => !isChatDirectoryPath(session.directory)) : sessions
);

export type SessionListRequest = {
    directory?: string;
    archived: boolean;
    roots?: boolean;
    search?: string;
    start?: number;
    cursor?: number;
    limit: number;
};

type SessionListResponse = {
    data?: Session[];
    error?: unknown;
    response?: {
        status?: number;
        headers?: unknown;
    };
};

export type SessionListClient = {
    experimental: {
        session: {
            list: (request: SessionListRequest) => Promise<SessionListResponse>;
        };
    };
};

/** The @opencode/client 2.x page: /api/session with the string cursor in the body. */
export type V2SessionListClient = {
    session: {
        list: (input: {
            directory?: string;
            search?: string;
            limit: number;
            cursor?: string;
        }) => Promise<{ data?: Session[]; cursor?: { previous?: string | null; next?: string | null } }>;
    };
};

const isLegacySessionClient = (client: SessionListClient | V2SessionListClient): client is SessionListClient => {
    const candidate = client as { experimental?: { session?: unknown } };
    return Boolean(candidate?.experimental?.session);
};

const toNumber = (value: string | null): number | null => {
    if (!value) {
        return null;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
};

const readResponseHeader = (response: unknown, header: string): string | null => {
    if (!response || typeof response !== "object") {
        return null;
    }
    const container = response as { headers?: unknown };
    const headers = container.headers;
    if (!headers || typeof headers !== "object") {
        return null;
    }

    const maybeGet = headers as { get?: (name: string) => string | null };
    if (typeof maybeGet.get === "function") {
        return maybeGet.get(header);
    }

    const maybeRecord = headers as Record<string, unknown>;
    const direct = maybeRecord[header] ?? maybeRecord[header.toLowerCase()];
    return typeof direct === "string" ? direct : null;
};

const formatSdkError = (error: unknown): string => {
    if (error instanceof Error) return error.message;
    if (typeof error === "string") return error;
    if (error && typeof error === "object" && "message" in error && typeof (error as { message?: unknown }).message === "string") {
        return (error as { message: string }).message;
    }
    try {
        return JSON.stringify(error);
    } catch {
        return String(error);
    }
};

const unwrapSessionList = (
    result: { data?: Session[]; error?: unknown; response?: { status?: number } },
    operation: string,
): GlobalSessionRecord[] => {
    if (result.error) {
        const status = result.response?.status;
        const error = new Error(`${operation} failed${status ? ` (${status})` : ""}: ${formatSdkError(result.error)}`);
        if (status !== undefined) {
            (error as Error & { status?: number }).status = status;
        }
        throw error;
    }

    if (result.data !== undefined && !Array.isArray(result.data)
        && !Array.isArray((result.data as { data?: unknown } | undefined)?.data)) {
        const error = new Error(`${operation} returned no data`);
        (error as Error & { status?: number }).status = 503;
        throw error;
    }

    return unwrapSessionListRows(result.data) as GlobalSessionRecord[];
};

const requestSessionPage = async (
    apiClient: SessionListClient | V2SessionListClient,
    request: SessionListRequest | {
        directory?: string;
        search?: string;
        limit: number;
        cursor?: string;
    },
): Promise<{ sessions: GlobalSessionRecord[]; response: unknown }> => {
    // The legacy SDK client (remote lanes against v1-shaped hosts) keeps the
    // /experimental/session page with its numeric x-next-cursor cursor. The
    // @opencode/client 2.0.21 instance has no such namespace — its
    // session.list is the /api/session page with the string cursor in the
    // body. Duck-type both so one walker serves the whole matrix.
    if (isLegacySessionClient(apiClient)) {
        const result = await runBackgroundNetworkTask(() => retry(
            () => apiClient.experimental.session.list(request as SessionListRequest),
            { attempts: 3, delay: 500, retryIf: () => true },
        ));

        return {
            sessions: unwrapSessionList(result, "experimental.session.list"),
            response: result.response,
        };
    }

    const result = await runBackgroundNetworkTask(() => retry(
        () => apiClient.session.list({
            ...(request.directory ? { directory: request.directory } : {}),
            ...(request.search ? { search: request.search } : {}),
            limit: request.limit,
            ...(typeof request.cursor === "number" ? { cursor: String(request.cursor) } : {}),
        }),
        { attempts: 3, delay: 500, retryIf: () => true },
    ));
    // The v2 wire nests the directory under `location`; project the rows into
    // the domain Session (top-level directory) or every group match fails.
    return {
        sessions: ((result.data ?? []) as unknown as SessionInfo[]).map(projectSession) as GlobalSessionRecord[],
        response: result,
    };
};

/** The v2 page cursor: `cursor.next` from the session page body. */
const readNextPageCursor = (client: V2SessionListClient | undefined, response: unknown): string | undefined => {
    if (client === undefined) return undefined;
    const page = response as { cursor?: { next?: string | null } };
    return page.cursor?.next ?? undefined;
};

export const readNextCursor = (response: unknown): number | null => {
    return toNumber(readResponseHeader(response, "x-next-cursor"));
};

export const isMissingGlobalSessionsEndpointError = (error: unknown): boolean => {
    if (!error || typeof error !== "object") {
        return false;
    }

    const value = error as {
        status?: number;
        response?: { status?: number };
        cause?: { status?: number; response?: { status?: number } };
    };

    const status = value.status
        ?? value.response?.status
        ?? value.cause?.status
        ?? value.cause?.response?.status;

    return status === 404;
};

const isArchivedSession = (session: GlobalSessionRecord): boolean => Boolean(session.time?.archived);

export const splitGlobalSessionsByArchived = <T extends GlobalSessionRecord>(
    sessions: T[],
): { active: T[]; archived: T[] } => {
    const active: T[] = [];
    const archived: T[] = [];
    for (const session of sessions) {
        if (isArchivedSession(session)) archived.push(session);
        else active.push(session);
    }
    return { active, archived };
};

export async function listGlobalSessionPage(
    apiClient: SessionListClient | V2SessionListClient,
    options: {
        directory?: string;
        archived: boolean;
        narrowToArchived?: boolean;
        roots?: boolean;
        search?: string;
        start?: number;
        pageSize: number;
    },
): Promise<GlobalSessionRecord[]> {
    // `roots` is a v1-only server filter: the v2 /api/session page returns
    // roots and children together and callers derive the tree client-side.
    const { sessions } = isLegacySessionClient(apiClient)
        ? await requestSessionPage(apiClient, {
            ...(options.directory ? { directory: options.directory } : {}),
            archived: options.archived,
            ...(options.roots !== undefined ? { roots: options.roots } : {}),
            ...(options.search ? { search: options.search } : {}),
            ...(options.start !== undefined ? { start: options.start } : {}),
            limit: options.pageSize,
        })
        : await requestSessionPage(apiClient, {
            ...(options.directory ? { directory: options.directory } : {}),
            archived: options.archived,
            ...(options.search ? { search: options.search } : {}),
            limit: options.pageSize,
        });
    const narrowToArchived = options.narrowToArchived !== false;
    if (options.archived && narrowToArchived) {
        return sessions.filter((session) => isArchivedSession(session));
    }
    return sessions;
}

export async function listGlobalSessionPages(
    apiClient: SessionListClient | V2SessionListClient,
    options: {
        directory?: string;
        archived: boolean;
        narrowToArchived?: boolean;
        roots?: boolean;
        search?: string;
        start?: number;
        pageSize: number;
        onPage?: (sessions: GlobalSessionRecord[]) => void;
    },
): Promise<GlobalSessionRecord[]> {
    const all: GlobalSessionRecord[] = [];
    const seenIds = new Set<string>();
    let numericCursor: number | undefined;
    let stringCursor: string | undefined;
    const narrowToArchived = options.narrowToArchived !== false;
    const isLegacy = isLegacySessionClient(apiClient as SessionListClient | V2SessionListClient);

    while (true) {
        const page = isLegacySessionClient(apiClient)
            ? await requestSessionPage(apiClient, {
                ...(options.directory ? { directory: options.directory } : {}),
                archived: options.archived,
                ...(options.roots !== undefined ? { roots: options.roots } : {}),
                ...(options.search ? { search: options.search } : {}),
                ...(options.start !== undefined ? { start: options.start } : {}),
                limit: options.pageSize,
                ...(numericCursor !== undefined ? { cursor: numericCursor } : {}),
        })
            : await requestSessionPage(apiClient, {
                ...(options.directory ? { directory: options.directory } : {}),
                archived: options.archived,
                ...(options.search ? { search: options.search } : {}),
                limit: options.pageSize,
                ...(stringCursor !== undefined ? { cursor: stringCursor } : {}),
        });

        const payload = page.sessions;
        if (payload.length === 0) break;

        let appended = 0;
        const accepted: GlobalSessionRecord[] = [];
        for (const session of payload) {
            if (!session?.id || seenIds.has(session.id)) continue;
            seenIds.add(session.id);
            appended += 1;
            if (options.archived && narrowToArchived && !isArchivedSession(session)) continue;
            all.push(session);
            accepted.push(session);
        }
        if (accepted.length > 0) {
            options.onPage?.(accepted);
        }

        // Stop on partial page — nothing more to fetch.
        if (payload.length < options.pageSize) break;

        if (isLegacy) {
            // Legacy cursor semantics on the server = "updated strictly before
            // this timestamp"; prefer the server header, fall back to the last
            // session's `time.updated`.
            const headerCursor = toNumber(readResponseHeader(page.response, "x-next-cursor"));
            const lastUpdated = payload[payload.length - 1]?.time?.updated;
            const nextCursor = headerCursor
                ?? (typeof lastUpdated === "number" && Number.isFinite(lastUpdated) ? lastUpdated : undefined);

            if (nextCursor === undefined) break;
            // Loop guard: cursor must move backwards in time.
            if (numericCursor !== undefined && nextCursor >= numericCursor) break;
            // Every id in this page already seen — stop to avoid spinning.
            if (appended === 0) break;

            numericCursor = nextCursor;
            continue;
        }

        // v2: the string cursor rides in the page body; `next` means "more".
        const nextCursor = readNextPageCursor(apiClient as V2SessionListClient, page.response);
        if (!nextCursor) break;
        if (stringCursor !== undefined && nextCursor === stringCursor) break;

        stringCursor = nextCursor;
    }

    return all;
}
