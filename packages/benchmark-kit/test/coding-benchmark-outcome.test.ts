import { PassThrough } from "node:stream";
import {
  access,
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  createLocalAgentRuntime,
  sha256,
  type OsSandboxAdapter,
  type SandboxLaunchRequest,
} from "@napier/runtime";
import { afterEach, describe, expect, it } from "vitest";

import { runCodingBenchmarkOutcomeTest } from "../src/coding-benchmark-outcome.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("coding benchmark Sandbox outcome test", () => {
  it("runs with read-only offline capabilities and returns hash-only output", async () => {
    const fixture = await createFixture();
    const launches: SandboxLaunchRequest[] = [];
    const sandbox = fakeSandbox({
      stdout: "PRIVATE_OUTCOME_STDOUT",
      onLaunch: (request) => launches.push(structuredClone(request)),
    });
    const source = "throw new Error('hidden test body');\n";
    const canonicalWorkspaceRoot = await realpath(fixture.workspaceRoot);

    const evidence = await runCodingBenchmarkOutcomeTest({
      ...fixture,
      env: { PRIVATE_PROVIDER_KEY: "PRIVATE_PROVIDER_VALUE" },
      testSource: source,
      testSha256: sha256(source),
      runtimeFactory: {
        createRuntime: (options) =>
          createLocalAgentRuntime({ ...options, sandbox }),
      },
    });

    expect(evidence).toEqual(
      expect.objectContaining({
        status: "succeeded",
        sandboxId: "fake-outcome-sandbox",
        exitCode: 0,
        passed: true,
        stdoutSha256: sha256("PRIVATE_OUTCOME_STDOUT"),
      }),
    );
    expect(JSON.stringify(evidence)).not.toContain("PRIVATE_OUTCOME_STDOUT");
    expect(launches).toEqual([
      expect.objectContaining({
        args: [".napier-benchmark-outcome.mjs"],
        cwd: canonicalWorkspaceRoot,
        workspaceRoot: canonicalWorkspaceRoot,
        approvedCapabilities: ["process.spawn", "workspace.read"],
        env: expect.not.objectContaining({
          PRIVATE_PROVIDER_KEY: expect.anything(),
        }),
      }),
    ]);
    await expect(
      access(path.join(fixture.workspaceRoot, ".napier-benchmark-outcome.mjs")),
    ).rejects.toThrow();
  });

  it("fails closed without deleting a colliding workspace file", async () => {
    const fixture = await createFixture();
    const collision = path.join(
      fixture.workspaceRoot,
      ".napier-benchmark-outcome.mjs",
    );
    await writeFile(collision, "workspace-owned\n", "utf8");
    let runtimeCreated = false;
    const source = "export {};\n";

    const evidence = await runCodingBenchmarkOutcomeTest({
      ...fixture,
      env: {},
      testSource: source,
      testSha256: sha256(source),
      runtimeFactory: {
        async createRuntime(options) {
          runtimeCreated = true;
          return createLocalAgentRuntime(options);
        },
      },
    });

    expect(evidence).toEqual(
      expect.objectContaining({
        status: "unavailable",
        sandboxId: "unavailable",
        passed: false,
      }),
    );
    expect(runtimeCreated).toBe(false);
    expect(await readFile(collision, "utf8")).toBe("workspace-owned\n");
  });

  it("classifies an unavailable nested Sandbox without host fallback", async () => {
    const fixture = await createFixture();
    const sandbox = fakeSandbox({
      id: "macos-sandbox-exec",
      stderr: "sandbox-exec: sandbox_apply: Operation not permitted\n",
      exitCode: 71,
    });
    const source = "export {};\n";

    const evidence = await runCodingBenchmarkOutcomeTest({
      ...fixture,
      env: {},
      testSource: source,
      testSha256: sha256(source),
      runtimeFactory: {
        createRuntime: (options) =>
          createLocalAgentRuntime({ ...options, sandbox }),
      },
    });

    expect(evidence).toEqual(
      expect.objectContaining({
        status: "unavailable",
        sandboxId: "macos-sandbox-exec",
        exitCode: 71,
        passed: false,
      }),
    );
    expect(JSON.stringify(evidence)).not.toContain("Operation not permitted");

    const spoofed = await runCodingBenchmarkOutcomeTest({
      ...fixture,
      env: {},
      testSource: source,
      testSha256: sha256(source),
      runtimeFactory: {
        createRuntime: (options) =>
          createLocalAgentRuntime({
            ...options,
            sandbox: fakeSandbox({
              id: "macos-sandbox-exec",
              stdout: "NAPIER_BENCHMARK_SANDBOX_STARTED\n",
              stderr: "sandbox-exec: sandbox_apply: Operation not permitted\n",
              exitCode: 71,
            }),
          }),
      },
    });
    expect(spoofed).toEqual(
      expect.objectContaining({
        status: "failed",
        sandboxId: "macos-sandbox-exec",
        passed: false,
      }),
    );
  });
});

async function createFixture(): Promise<{
  workspaceRoot: string;
  dataRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-outcome-test-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const dataRoot = path.join(root, "state");
  await mkdir(workspaceRoot);
  return { workspaceRoot, dataRoot };
}

function fakeSandbox(options: {
  id?: string;
  stdout?: string;
  stderr?: string;
  exitCode?: number;
  onLaunch?: (request: SandboxLaunchRequest) => void;
}): OsSandboxAdapter {
  return {
    id: options.id ?? "fake-outcome-sandbox",
    async launch(request) {
      options.onLaunch?.(request);
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        setTimeout(() => {
          if (options.stdout) stdout.write(options.stdout);
          if (options.stderr) stderr.write(options.stderr);
          stdout.end();
          stderr.end();
          resolve({ code: options.exitCode ?? 0, signal: null });
        }, 0);
      });
      return {
        stdin,
        stdout,
        stderr,
        exit,
        terminate: async () => {
          await exit;
        },
      };
    },
  };
}
