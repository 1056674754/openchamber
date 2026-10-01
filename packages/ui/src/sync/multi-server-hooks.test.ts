import { describe, expect, test } from "bun:test";
import type { FormRequest } from "@/types/form";
import { DEFAULT_SERVER_ID } from "@/lib/opencode/server-registry";
import { ChildStoreManager } from "./child-store";
import {
  collectBlockingRequests,
  collectServerSessions,
  isSameBlockingRequestSnapshot,
} from "./multi-server-hooks";
import { registerSyncStores } from "./multi-server-registry";

describe("multi-server blocking requests", () => {
  test("builds the session graph only from the authoritative server", () => {
    const sessionID = "ses-shared";
    const localStores = new ChildStoreManager();
    const remoteStores = new ChildStoreManager();
    const localSession = {
      id: sessionID,
      slug: "local-session",
      projectID: "project-local",
      title: "Local session",
      version: "1",
      directory: "/local",
      time: { created: 1, updated: 1 },
    };
    const remoteSession = {
      id: sessionID,
      slug: "remote-session",
      projectID: "project-remote",
      title: "Remote session",
      version: "1",
      directory: "/remote",
      time: { created: 2, updated: 2 },
    };

    localStores.ensureChild("/local", { bootstrap: false }).getState().patch({
      session: [localSession],
    });
    remoteStores.ensureChild("/remote", { bootstrap: false }).getState().patch({
      session: [remoteSession],
    });
    const unregister = registerSyncStores("remote-session-test", remoteStores, () => undefined);

    try {
      expect(collectServerSessions(localStores, DEFAULT_SERVER_ID)).toEqual([localSession]);
      expect(collectServerSessions(localStores, "remote-session-test")).toEqual([remoteSession]);
    } finally {
      unregister();
    }
  });

  test("reads blocking requests only from the authoritative server", () => {
    const sessionID = "ses-shared";
    const localStores = new ChildStoreManager();
    const remoteStores = new ChildStoreManager();
    const localQuestion: FormRequest = {
      id: "que-1",
      sessionID,
      questions: [{ header: "Local", question: "Local question", options: [] }],
    };
    const remoteQuestion: FormRequest = {
      id: "que-1",
      sessionID,
      questions: [{ header: "Remote", question: "Remote question", options: [] }],
    };

    localStores.ensureChild("/shared", { bootstrap: false }).getState().patch({
      form: { [sessionID]: [localQuestion] },
    });
    remoteStores.ensureChild("/shared", { bootstrap: false }).getState().patch({
      form: { [sessionID]: [remoteQuestion] },
    });
    const unregister = registerSyncStores("remote-question-test", remoteStores, () => undefined);

    try {
      expect(collectBlockingRequests<FormRequest>(
        "form",
        localStores,
        DEFAULT_SERVER_ID,
        [{ sessionId: sessionID, directory: "/shared" }],
      )).toEqual([localQuestion]);
      expect(collectBlockingRequests<FormRequest>(
        "form",
        localStores,
        "remote-question-test",
        [{ sessionId: sessionID, directory: "/shared" }],
      )).toEqual([remoteQuestion]);
    } finally {
      unregister();
    }
  });

  test("does not fall back to local data while a remote store is unavailable", () => {
    const stores = new ChildStoreManager();
    const question: FormRequest = {
      id: "que-1",
      sessionID: "ses-1",
      questions: [],
    };
    stores.ensureChild("/local", { bootstrap: false }).getState().patch({
      form: { "ses-1": [question] },
    });

    expect(collectBlockingRequests<FormRequest>(
      "form",
      stores,
      "remote-not-mounted",
      [{ sessionId: "ses-1", directory: "/local" }],
    )).toEqual([]);
  });

  test("ignores a same-ID request copied into a non-authoritative directory", () => {
    const stores = new ChildStoreManager();
    const sessionID = "ses-1";
    const authoritative: FormRequest = {
      id: "que-1",
      sessionID,
      questions: [{ header: "Right", question: "Authoritative question", options: [] }],
    };
    const stale: FormRequest = {
      id: "que-1",
      sessionID,
      questions: [{ header: "Wrong", question: "Stale question", options: [] }],
    };
    stores.ensureChild("/wrong", { bootstrap: false }).getState().patch({
      form: { [sessionID]: [stale] },
    });
    stores.ensureChild("/right", { bootstrap: false }).getState().patch({
      form: { [sessionID]: [authoritative] },
    });

    expect(collectBlockingRequests<FormRequest>(
      "form",
      stores,
      DEFAULT_SERVER_ID,
      [{ sessionId: sessionID, directory: "/right" }],
    )).toEqual([authoritative]);
  });

  test("does not reuse a same-ID snapshot after the authoritative server changes", () => {
    const localQuestion = { id: "que-1" };
    const remoteQuestion = { id: "que-1" };

    expect(isSameBlockingRequestSnapshot(
      DEFAULT_SERVER_ID,
      [localQuestion],
      "remote-a",
      [remoteQuestion],
    )).toBe(false);
    expect(isSameBlockingRequestSnapshot(
      DEFAULT_SERVER_ID,
      [localQuestion],
      DEFAULT_SERVER_ID,
      [remoteQuestion],
    )).toBe(false);
    expect(isSameBlockingRequestSnapshot(
      DEFAULT_SERVER_ID,
      [localQuestion],
      DEFAULT_SERVER_ID,
      [localQuestion],
    )).toBe(true);
  });
});
