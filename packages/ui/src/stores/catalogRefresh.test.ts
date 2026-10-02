import { describe, expect, test } from "bun:test";

import { catalogRefreshTasks } from "./catalogRefresh";

// Fork port of upstream 654705f7d's catalogRefresh test (OC2 spine S6). The
// store loaders are the fork's own directory-scoped ones; the task mapping is
// upstream's.

describe("catalogRefreshTasks", () => {
  test("a config rebuild re-reads every list a config file can carry", () => {
    // Agents, commands, skills, MCP servers, plugins and providers all live
    // in config, and OpenChamber's own plugin injection is one of them.
    expect(catalogRefreshTasks("config")).toHaveLength(6);
  });

  test("a single-catalog rebuild re-reads only that list", () => {
    for (const kind of ["agent", "command", "skill", "plugin", "provider", "credential"] as const) {
      expect(catalogRefreshTasks(kind)).toHaveLength(1);
    }
  });

  test("provider and model announcements both re-read the provider list", () => {
    expect(catalogRefreshTasks("model")).toEqual(catalogRefreshTasks("provider"));
  });

  test("projects belong to the sync stores, not to the settings lists", () => {
    expect(catalogRefreshTasks("project")).toEqual([]);
  });
});
