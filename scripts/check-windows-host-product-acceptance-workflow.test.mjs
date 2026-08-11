import { cp, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { auditWindowsHostProductAcceptanceWorkflow } from "./check-windows-host-product-acceptance-workflow.mjs";
import {
  createWindowsAcceptanceEnvironment,
  withWindowsAcceptanceEnvironment,
  windowsProcessTreeKillCommand,
} from "./windows-host-product-acceptance-support.mjs";

const roots = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Windows host product acceptance workflow", () => {
  it("uses taskkill to terminate a bounded Windows process tree", () => {
    expect(windowsProcessTreeKillCommand(123, "win32")).toEqual({
      command: "taskkill.exe",
      args: ["/PID", "123", "/T", "/F"],
    });
    expect(windowsProcessTreeKillCommand(123, "linux")).toBeUndefined();
  });

  it("isolates npm and Docker from ambient runner credentials", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-windows-environment-"),
    );
    roots.push(root);
    const environment = await createWindowsAcceptanceEnvironment(
      {
        ComSpec: "C:\\Windows\\System32\\cmd.exe",
        PATH: "C:\\tools",
        PATHEXT: ".COM;.EXE;.BAT;.CMD",
        SystemRoot: "C:\\Windows",
        WINDIR: "C:\\Windows",
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        RUNNER_ENVIRONMENT: "self-hosted",
        RUNNER_OS: "Windows",
        RUNNER_ARCH: "X64",
        RUNNER_TEMP: root,
        GITHUB_TOKEN: "secret",
        NODE_AUTH_TOKEN: "secret",
        NPM_TOKEN: "secret",
        DOCKER_AUTH_CONFIG: "secret",
      },
      path.join(root, "isolated"),
    );

    expect(environment).toEqual(
      expect.objectContaining({
        DOCKER_HOST: "npipe:////./pipe/docker_engine",
        NPM_CONFIG_REGISTRY: "https://registry.npmjs.org/",
        NPM_CONFIG_AUDIT: "false",
        NPM_CONFIG_FUND: "false",
      }),
    );
    expect(environment).not.toHaveProperty("GITHUB_TOKEN");
    expect(environment).not.toHaveProperty("NODE_AUTH_TOKEN");
    expect(environment).not.toHaveProperty("NPM_TOKEN");
    expect(environment).not.toHaveProperty("DOCKER_AUTH_CONFIG");
    await expect(
      readFile(path.join(environment.DOCKER_CONFIG, "config.json"), "utf8"),
    ).resolves.toBe('{"auths":{}}\n');
    await expect(
      readFile(environment.NPM_CONFIG_USERCONFIG, "utf8"),
    ).resolves.toBe(
      "registry=https://registry.npmjs.org/\nalways-auth=false\n",
    );
    await expect(
      readFile(environment.NPM_CONFIG_GLOBALCONFIG, "utf8"),
    ).resolves.toBe("");
  });

  it("restores ambient state and removes the isolated root after failure", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-windows-environment-"),
    );
    roots.push(root);
    const before = { ...process.env };
    process.env.RUNNER_TEMP = root;
    process.env.GITHUB_RUN_ID = "123";
    process.env.GITHUB_RUN_ATTEMPT = "1";
    process.env.RUNNER_ENVIRONMENT = "self-hosted";
    process.env.RUNNER_OS = "Windows";
    process.env.RUNNER_ARCH = "X64";
    process.env.GITHUB_TOKEN = "secret";
    let isolatedHome;
    try {
      await expect(
        withWindowsAcceptanceEnvironment(async () => {
          isolatedHome = process.env.HOME;
          expect(process.env.GITHUB_TOKEN).toBeUndefined();
          throw new Error("expected failure");
        }),
      ).rejects.toThrow("expected failure");
      expect(process.env).toEqual({
        ...before,
        RUNNER_TEMP: root,
        GITHUB_RUN_ID: "123",
        GITHUB_RUN_ATTEMPT: "1",
        RUNNER_ENVIRONMENT: "self-hosted",
        RUNNER_OS: "Windows",
        RUNNER_ARCH: "X64",
        GITHUB_TOKEN: "secret",
      });
      await expect(
        readFile(path.join(isolatedHome, ".missing")),
      ).rejects.toThrow();
      await expect(
        readFile(path.join(path.dirname(isolatedHome), "npm-user.conf")),
      ).rejects.toThrow();
    } finally {
      for (const name of Object.keys(process.env)) delete process.env[name];
      Object.assign(process.env, before);
    }
  });

  it("accepts the current manual, least-privilege, self-hosted gate", async () => {
    await expect(auditWindowsHostProductAcceptanceWorkflow()).resolves.toEqual({
      valid: true,
      errors: [],
      path: ".github/workflows/windows-host-product-acceptance.yml",
    });
  });

  it("rejects automatic triggers, hosted runners, permissions, and tags", async () => {
    for (const mutate of [
      (source) =>
        source.replace(
          "on:\n  workflow_dispatch:",
          "on:\n  push:\n    branches: [main]\n  workflow_dispatch:",
        ),
      (source) =>
        source.replace(
          "    runs-on:\n      - self-hosted\n      - Windows\n      - X64\n      - napier-windows-docker",
          "    runs-on: windows-2025",
        ),
      (source) =>
        source.replace(
          "permissions:\n  contents: read",
          "permissions:\n  contents: write\n  packages: write",
        ),
      (source) =>
        source.replace(
          "      - napier-windows-docker",
          "      - generic-windows",
        ),
    ]) {
      const root = await fixtureRoot(mutate);
      const result = await auditWindowsHostProductAcceptanceWorkflow({
        repoRoot: root,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects unpinned actions, missing exact-main checks, and weak cleanup", async () => {
    for (const mutate of [
      (source) =>
        source.replace(
          "actions/checkout@d23441a48e516b6c34aea4fa41551a30e30af803",
          "actions/checkout@v6",
        ),
      (source) =>
        source.replace(
          "git.exe rev-parse refs/remotes/origin/main",
          "git.exe rev-parse HEAD",
        ),
      (source) =>
        source.replace(
          "          git.exe reset --hard HEAD\n          git.exe clean -ffdx",
          "          git status",
        ),
      (source) =>
        source.replace(
          "      - name: Remove acceptance output\n        if: always()",
          "      - name: Remove acceptance output",
        ),
      (source) =>
        source.replace(
          "scripts/check-windows-host-product-acceptance.mjs",
          "scripts/accept-without-verification.mjs",
        ),
      (source) =>
        source.replace(
          "              Where-Object { $_ -notin $baseline } |",
          "              Where-Object { $false } |",
        ),
      (source) =>
        source.replace(
          "            if (Compare-Object $expected $observed) {",
          "            if ($false) {",
        ),
    ]) {
      const root = await fixtureRoot(mutate);
      const result = await auditWindowsHostProductAcceptanceWorkflow({
        repoRoot: root,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });

  it("rejects weakened Windows, Docker, ConPTY, product, and recovery checks", async () => {
    for (const mutateLive of [
      (source) =>
        source.replace(
          'const DOCKER_ENDPOINT = "npipe:////./pipe/docker_engine"',
          'const DOCKER_ENDPOINT = "tcp://remote.example:2375"',
        ),
      (source) =>
        source.replace(
          'const binaryRelative = "prebuilds/win32-x64/conpty.node"',
          'const binaryRelative = "prebuilds/win32-x64/pty.node"',
        ),
      (source) =>
        source.replace(
          'await import("./check-sandbox-product-acceptance.mjs")',
          'await import("./synthetic-product-check.mjs")',
        ),
      (source) =>
        source.replace(
          "restoreWindowsImageEvidence(",
          "skipWindowsImageEvidenceRestore(",
        ),
    ]) {
      const root = await fixtureRoot((source) => source, mutateLive);
      const result = await auditWindowsHostProductAcceptanceWorkflow({
        repoRoot: root,
      });

      expect(result.valid).toBe(false);
      expect(result.errors.length).toBeGreaterThan(0);
    }
  });
});

async function fixtureRoot(mutate, mutateLive = (source) => source) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-windows-workflow-"));
  roots.push(root);
  for (const [relative, transform] of [
    [".github/workflows/windows-host-product-acceptance.yml", mutate],
    ["scripts/windows-host-product-acceptance-live.mjs", mutateLive],
    ["scripts/windows-host-product-acceptance-support.mjs", (source) => source],
  ]) {
    const target = path.join(root, relative);
    await mkdir(path.dirname(target), { recursive: true });
    await cp(path.resolve(relative), target);
    const source = await readFile(target, "utf8");
    await writeFile(target, transform(source));
  }
  return root;
}
