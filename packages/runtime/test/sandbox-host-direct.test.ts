import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { createPlatformSandboxAdapter } from "../src/sandbox.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { sandboxIsolationStrength } from "../src/doctor-runtime-probes.js";

describe("host-direct sandbox adapter", () => {
  it("activates only on explicit opt-in", () => {
    expect(HostDirectSandboxAdapter.enabled("1")).toBe(true);
    expect(HostDirectSandboxAdapter.enabled("true")).toBe(true);
    expect(HostDirectSandboxAdapter.enabled("yes")).toBe(true);
    expect(HostDirectSandboxAdapter.enabled("0")).toBe(false);
    expect(HostDirectSandboxAdapter.enabled(undefined)).toBe(false);
    expect(HostDirectSandboxAdapter.enabled("")).toBe(false);
  });

  it("is not selected by default and takes precedence over native adapters when opted in", () => {
    delete process.env["NAPIER_HOST_DIRECT_SANDBOX"];
    delete process.env["NAPIER_CONTAINER_SANDBOX_IMAGE"];
    expect(createPlatformSandboxAdapter("darwin").id).toBe("macos-sandbox-exec");
    process.env["NAPIER_HOST_DIRECT_SANDBOX"] = "1";
    try {
      expect(createPlatformSandboxAdapter("darwin").id).toBe("host-direct");
      expect(createPlatformSandboxAdapter("linux").id).toBe("host-direct");
    } finally {
      delete process.env["NAPIER_HOST_DIRECT_SANDBOX"];
    }
  });

  it("honestly reports no isolation", () => {
    const strength = sandboxIsolationStrength("host-direct");
    expect(strength.level).toBe("none");
    expect(strength.networkDeniedByDefault).toBe(false);
    expect(strength.resourceLimited).toBe(false);
    expect(strength.summary).toContain("no OS isolation");
  });

  it("runs a real command directly on the host", async () => {
    const workspace = await mkdtemp(path.join(tmpdir(), "napier-host-direct-ws-"));
    try {
      const adapter = new HostDirectSandboxAdapter();
      const child = await adapter.launch({
        command: process.execPath,
        args: ["-e", "process.stdout.write('host-ok')"],
        cwd: workspace,
        env: { PATH: process.env.PATH ?? "" },
        workspaceRoot: workspace,
        approvedCapabilities: ["process.spawn"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk) => {
        stdout += String(chunk);
      });
      const exit = await child.exit;
      expect(exit.code).toBe(0);
      expect(stdout).toContain("host-ok");
    } finally {
      await rm(workspace, { recursive: true, force: true });
    }
  });
});
