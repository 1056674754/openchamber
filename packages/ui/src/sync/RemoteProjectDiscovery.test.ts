import { describe, expect, test } from "bun:test";

import { getRemoteProjectDiscoveryKey } from "./remote-project-discovery-key";

describe("remote project discovery keys", () => {
  test("scopes identical remote paths by server id", () => {
    expect(getRemoteProjectDiscoveryKey("remote-a", "/home/user/repo")).toBe("remote-a:/home/user/repo");
    expect(getRemoteProjectDiscoveryKey("remote-b", "/home/user/repo")).toBe("remote-b:/home/user/repo");
    expect(getRemoteProjectDiscoveryKey("remote-a", "/home/user/repo")).not.toBe(
      getRemoteProjectDiscoveryKey("remote-b", "/home/user/repo"),
    );
  });

  test("normalizes trailing slashes within the same server", () => {
    expect(getRemoteProjectDiscoveryKey("remote-a", "/home/user/repo/")).toBe(
      getRemoteProjectDiscoveryKey("remote-a", "/home/user/repo"),
    );
  });
});
