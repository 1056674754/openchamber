import { beforeEach, describe, expect, mock, test } from "bun:test";

mock.module("@/lib/opencode/client", () => ({
  opencodeClient: {
    setDirectory: () => {},
  },
}));

const { useProjectsStore } = await import("./useProjectsStore");

beforeEach(() => {
  useProjectsStore.setState({
    projects: [],
    activeProjectId: null,
    hasLoadedSharedSettings: false,
  });
});

describe("projects settings hydration", () => {
  test("does not let remote discovery persist projects before shared settings load", () => {
    const unhydratedStore = useProjectsStore.getState();

    const discoveredBeforeHydration = unhydratedStore.ensureRemoteProject("/remote/project", "remote-a");

    expect(discoveredBeforeHydration).toBeNull();
    expect(useProjectsStore.getState().projects).toEqual([]);
  });

  test("allows remote discovery after shared settings load", () => {
    useProjectsStore.getState().synchronizeFromSettings({ projects: [] });

    const discoveredAfterHydration = useProjectsStore
      .getState()
      .ensureRemoteProject("/remote/project", "remote-a");

    expect(discoveredAfterHydration?.serverId).toBe("remote-a");
    expect(useProjectsStore.getState().projects).toHaveLength(1);
  });

  test("preserves hydrated local projects when remote discovery appends projects", () => {
    useProjectsStore.getState().synchronizeFromSettings({
      projects: [{ id: "local-project", path: "/local/project" }],
      activeProjectId: "local-project",
    });

    useProjectsStore.getState().ensureRemoteProject("/remote/project", "remote-a");

    expect(useProjectsStore.getState().projects).toHaveLength(2);
    expect(useProjectsStore.getState().projects[0]?.path).toBe("/local/project");
    expect(useProjectsStore.getState().projects[1]?.path).toBe("/remote/project");
    expect(useProjectsStore.getState().projects[1]?.serverId).toBe("remote-a");
  });

  test("keeps a thinking default only beside its project model", () => {
    useProjectsStore.getState().synchronizeFromSettings({
      projects: [
        { id: "with-model", path: "/local/one", defaultModel: "openai/gpt-5", defaultVariant: "high" },
        { id: "without-model", path: "/local/two", defaultVariant: "high" },
      ],
    });

    expect(useProjectsStore.getState().projects[0]?.defaultModel).toBe("openai/gpt-5");
    expect(useProjectsStore.getState().projects[0]?.defaultVariant).toBe("high");
    expect(useProjectsStore.getState().projects[1]?.defaultVariant).toBeUndefined();
  });
});
