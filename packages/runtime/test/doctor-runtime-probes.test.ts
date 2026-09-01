import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  probeGitRuntime,
  probeLocalServiceRuntime,
  probePythonRuntime,
  probeShellRuntime,
  probeSkillsRuntime,
  sandboxIsolationStrength,
} from "../src/doctor-runtime-probes.js";
import { HostDirectSandboxAdapter } from "../src/sandbox-host-direct.js";
import { UnsupportedSandboxAdapter } from "../src/unsupported-sandbox.js";

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
    expect(sandboxIsolationStrength("linux-bubblewrap").level).toBe(
      "namespace",
    );
  });

  it("reports no isolation for unsupported hosts", () => {
    const strength = sandboxIsolationStrength("unsupported");
    expect(strength.level).toBe("none");
    expect(strength.networkDeniedByDefault).toBe(false);
    expect(strength.summary).toContain("fail closed");
  });
});

describe("Shell Doctor probe", () => {
  it("executes the production shell, child command, parent guard, and PTY path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-shell-"));
    try {
      await expect(
        probeShellRuntime(root, undefined, new HostDirectSandboxAdapter()),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "ready",
          code: "shell_ready",
          evidence: expect.objectContaining({
            adapter: "host-direct",
            productionCall: true,
            pty: true,
            executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            exitCode: 0,
          }),
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not report Shell ready when the active provider cannot launch", async () => {
    const result = await probeShellRuntime(
      process.cwd(),
      undefined,
      new UnsupportedSandboxAdapter("doctor-test"),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "unavailable",
        code: "shell_provider_unavailable",
      }),
    );
  });
});

describe("local service Doctor probe", () => {
  it("fails closed when the active provider cannot publish a bounded service", async () => {
    const result = await probeLocalServiceRuntime(
      process.cwd(),
      undefined,
      new HostDirectSandboxAdapter(),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "unavailable",
        code: "service_provider_unavailable",
      }),
    );
  });
});

describe("Python Doctor probe", () => {
  it("executes the production Python command through the active provider", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-python-"));
    try {
      await expect(
        probePythonRuntime(root, undefined, new HostDirectSandboxAdapter()),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "ready",
          code: "python_ready",
          evidence: expect.objectContaining({
            adapter: "host-direct",
            productionCall: true,
            pty: false,
            runtimeAssetCount: expect.any(Number),
            executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            exitCode: 0,
          }),
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not report Python ready when the active provider cannot launch", async () => {
    const result = await probePythonRuntime(
      process.cwd(),
      undefined,
      new UnsupportedSandboxAdapter("doctor-test"),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "unavailable",
        code: "python_provider_unavailable",
      }),
    );
  });
});

describe("Git Doctor probe", () => {
  it("executes the production Git command through the active provider", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-git-"));
    try {
      await expect(
        probeGitRuntime(root, undefined, new HostDirectSandboxAdapter()),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "ready",
          code: "git_ready",
          evidence: expect.objectContaining({
            adapter: "host-direct",
            productionCall: true,
            executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            resourceLimitsSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            exitCode: 0,
          }),
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  it("does not report Git ready when the active provider cannot launch", async () => {
    const result = await probeGitRuntime(
      process.cwd(),
      undefined,
      new UnsupportedSandboxAdapter("doctor-test"),
    );
    expect(result).toEqual(
      expect.objectContaining({
        status: "unavailable",
        code: "git_provider_unavailable",
      }),
    );
  });
});

describe("Skill loader Doctor probe", () => {
  it("executes the production loader and returns only sanitized evidence", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-skill-"));
    const home = await mkdtemp(path.join(tmpdir(), "napier-doctor-home-"));
    try {
      const directory = path.join(root, "skills", "research-brief");
      await mkdir(directory, { recursive: true });
      await writeFile(
        path.join(directory, "SKILL.md"),
        "---\nname: research-brief\ndescription: Doctor fixture.\n---\n\nPRIVATE_DOCTOR_SKILL_BODY\n",
      );
      const result = await probeSkillsRuntime(root, { userHome: home });
      expect(result).toEqual(
        expect.objectContaining({
          status: "ready",
          code: "skills_ready",
          evidence: expect.objectContaining({
            present: 5,
            admitted: 5,
            productionCall: true,
            resourceToolConstructed: true,
            resourceProductionCall: false,
            catalogSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            source: "project",
            rootKind: "project_legacy",
          }),
        }),
      );
      expect(JSON.stringify(result)).not.toContain("PRIVATE_DOCTOR_SKILL_BODY");
      expect(JSON.stringify(result)).not.toContain(root);
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });

  it("does not report ready when a present Skill fails production admission", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-doctor-skill-"));
    const home = await mkdtemp(path.join(tmpdir(), "napier-doctor-home-"));
    try {
      const directory = path.join(root, "skills", "bad-skill");
      await mkdir(directory, { recursive: true });
      await writeFile(path.join(directory, "SKILL.md"), "not frontmatter\n");
      await expect(
        probeSkillsRuntime(root, { userHome: home }),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "unavailable",
          code: "skills_unavailable",
          evidence: { present: 6, productionCall: false },
        }),
      );
    } finally {
      await rm(root, { recursive: true, force: true });
      await rm(home, { recursive: true, force: true });
    }
  });
});
