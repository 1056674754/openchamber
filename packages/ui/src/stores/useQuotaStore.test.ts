import { beforeEach, describe, expect, test } from "bun:test";

import { QUOTA_PROVIDERS } from "@/lib/quota";
import type { ProviderResult, QuotaProviderId } from "@/types";
import { useQuotaStore } from "./useQuotaStore";

type Deferred<T> = {
	readonly promise: Promise<T>;
	readonly resolve: (value: T) => void;
};

const originalFetch = globalThis.fetch;
const initialQuotaState = useQuotaStore.getState();

const createDeferred = <T>(): Deferred<T> => {
	let resolvePromise: (value: T) => void = () => {
		throw new Error("Deferred promise was resolved before initialization");
	};
	const promise = new Promise<T>((resolve) => {
		resolvePromise = resolve;
	});
	return { promise, resolve: resolvePromise };
};

const createQuotaResult = (providerId: QuotaProviderId): ProviderResult => ({
	providerId,
	providerName: providerId,
	ok: true,
	configured: true,
	usage: null,
	fetchedAt: 1,
});

const jsonResponse = (result: ProviderResult): Response =>
	new Response(JSON.stringify(result), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

describe("useQuotaStore per-provider refresh", () => {
	beforeEach(() => {
		globalThis.fetch = originalFetch;
		useQuotaStore.setState(initialQuotaState);
	});

	test("routes an explicit remote base URL to the provider quota endpoint", async () => {
		// Given
		const fetchInputs: Array<RequestInfo | URL> = [];
		try {
			globalThis.fetch = async (input) => {
				fetchInputs.push(input);
				return jsonResponse(createQuotaResult("codex"));
			};

			// When
			await useQuotaStore
				.getState()
				.fetchProviderQuota("codex", "/api/remote/test-server");

			// Then
			expect(fetchInputs).toEqual([
				"/api/remote/test-server/quota/codex",
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("keeps a new quota provider on the selected remote instance", async () => {
		const fetchInputs: Array<RequestInfo | URL> = [];
		try {
			globalThis.fetch = async (input) => {
				fetchInputs.push(input);
				return jsonResponse(createQuotaResult("crof"));
			};

			await useQuotaStore
				.getState()
				.fetchProviderQuota("crof", "/api/remote/test-server");

			expect(fetchInputs).toEqual([
				"/api/remote/test-server/quota/crof",
			]);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("keeps concurrent provider loading independent from global loading", async () => {
		// Given
		const codexResponse = createDeferred<Response>();
		const claudeResponse = createDeferred<Response>();
		try {
			globalThis.fetch = async (input) => {
				const url = String(input);
				if (url.endsWith("/codex")) {
					return codexResponse.promise;
				}
				if (url.endsWith("/claude")) {
					return claudeResponse.promise;
				}
				return new Response(null, { status: 404 });
			};

			// When
			const codexRefresh = useQuotaStore.getState().fetchProviderQuota("codex");
			const claudeRefresh = useQuotaStore.getState().fetchProviderQuota("claude");

			// Then
			expect(useQuotaStore.getState().isFetchingProvider.codex).toBe(true);
			expect(useQuotaStore.getState().isFetchingProvider.claude).toBe(true);
			expect(useQuotaStore.getState().isLoading).toBe(false);

			codexResponse.resolve(jsonResponse(createQuotaResult("codex")));
			await codexRefresh;
			expect(useQuotaStore.getState().isFetchingProvider.codex).toBe(false);
			expect(useQuotaStore.getState().isFetchingProvider.claude).toBe(true);
			expect(useQuotaStore.getState().isLoading).toBe(false);

			claudeResponse.resolve(jsonResponse(createQuotaResult("claude")));
			await claudeRefresh;
			expect(useQuotaStore.getState().isFetchingProvider.codex).toBe(false);
			expect(useQuotaStore.getState().isFetchingProvider.claude).toBe(false);
			expect(useQuotaStore.getState().isLoading).toBe(false);
		} finally {
			globalThis.fetch = originalFetch;
		}
	});

	test("joins an individual refresh and fetch-all refresh for the same endpoint", async () => {
		// Given
		const codexResponse = createDeferred<Response>();
		const fetchInputs: string[] = [];
		let individualRefresh = Promise.resolve();
		let allRefresh = Promise.resolve();
		let individualRefreshCompleted = false;
		let allRefreshCompleted = false;
		try {
			globalThis.fetch = async (input) => {
				const url = String(input);
				fetchInputs.push(url);
				const provider = QUOTA_PROVIDERS.find(({ id }) => url.endsWith(`/${id}`));
				if (!provider) {
					return new Response(null, { status: 404 });
				}
				if (provider.id === "codex") {
					return codexResponse.promise;
				}
				return jsonResponse(createQuotaResult(provider.id));
			};

			// When
			individualRefresh = useQuotaStore.getState().fetchProviderQuota("codex");
			allRefresh = useQuotaStore.getState().fetchAllQuotas();
			void individualRefresh.then(() => {
				individualRefreshCompleted = true;
			});
			void allRefresh.then(() => {
				allRefreshCompleted = true;
			});
			await Promise.resolve();

			// Then
			expect(fetchInputs.filter((url) => url === "/api/quota/codex")).toHaveLength(1);
			expect(individualRefreshCompleted).toBe(false);
			expect(allRefreshCompleted).toBe(false);
			expect(useQuotaStore.getState().isFetchingProvider.codex).toBe(true);
			expect(useQuotaStore.getState().isLoading).toBe(true);

			codexResponse.resolve(jsonResponse(createQuotaResult("codex")));
			await Promise.all([individualRefresh, allRefresh]);
			expect(useQuotaStore.getState().isFetchingProvider.codex).toBe(false);
			expect(useQuotaStore.getState().isLoading).toBe(false);
		} finally {
			codexResponse.resolve(jsonResponse(createQuotaResult("codex")));
			await Promise.all([individualRefresh, allRefresh]);
			globalThis.fetch = originalFetch;
		}
	});

	test("keeps local and remote requests distinct while aggregating provider loading", async () => {
		// Given
		const localResponse = createDeferred<Response>();
		const remoteResponse = createDeferred<Response>();
		const fetchInputs: string[] = [];
		let localRefresh = Promise.resolve();
		let remoteRefresh = Promise.resolve();
		try {
			globalThis.fetch = async (input) => {
				const url = String(input);
				fetchInputs.push(url);
				if (url === "/api/quota/codex") {
					return localResponse.promise;
				}
				if (url === "/api/remote/test-server/quota/codex") {
					return remoteResponse.promise;
				}
				return new Response(null, { status: 404 });
			};

			// When
			localRefresh = useQuotaStore.getState().fetchProviderQuota("codex");
			remoteRefresh = useQuotaStore
				.getState()
				.fetchProviderQuota("codex", "/api/remote/test-server");
			await Promise.resolve();

			// Then
			expect(fetchInputs).toEqual([
				"/api/quota/codex",
				"/api/remote/test-server/quota/codex",
			]);
			expect(useQuotaStore.getState().isFetchingProvider.codex).toBe(true);

			localResponse.resolve(jsonResponse(createQuotaResult("codex")));
			await localRefresh;
			expect(useQuotaStore.getState().isFetchingProvider.codex).toBe(true);

			remoteResponse.resolve(jsonResponse(createQuotaResult("codex")));
			await remoteRefresh;
			expect(useQuotaStore.getState().isFetchingProvider.codex).toBe(false);
		} finally {
			localResponse.resolve(jsonResponse(createQuotaResult("codex")));
			remoteResponse.resolve(jsonResponse(createQuotaResult("codex")));
			await Promise.all([localRefresh, remoteRefresh]);
			globalThis.fetch = originalFetch;
		}
	});
});
