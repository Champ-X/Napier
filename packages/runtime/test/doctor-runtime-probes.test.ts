import { describe, expect, it } from "vitest";

import { sandboxIsolationStrength } from "../src/doctor-runtime-probes.js";

describe("sandbox isolation strength", () => {
  it("reports container isolation with resource limits for OCI", () => {
    const strength = sandboxIsolationStrength("oci-container");
    expect(strength.level).toBe("container");
    expect(strength.networkDeniedByDefault).toBe(true);
    expect(strength.resourceLimited).toBe(true);
  });

  it("reports OS-profile isolation without resource ceilings on macOS", () => {
    const strength = sandboxIsolationStrength("macos-sandbox-exec");
    expect(strength.level).toBe("os_profile");
    expect(strength.networkDeniedByDefault).toBe(true);
    expect(strength.resourceLimited).toBe(false);
  });

  it("reports namespace isolation for bubblewrap", () => {
    expect(sandboxIsolationStrength("linux-bubblewrap").level).toBe("namespace");
  });

  it("reports no isolation for unsupported hosts", () => {
    const strength = sandboxIsolationStrength("unsupported");
    expect(strength.level).toBe("none");
    expect(strength.networkDeniedByDefault).toBe(false);
    expect(strength.summary).toContain("fail closed");
  });
});
