import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  realpath,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";
import {
  createVerificationTool,
  VerificationRunner,
} from "../src/verification.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  vi.useRealTimers();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

async function createWorkspace(): Promise<{
  root: string;
  workspaceRoot: string;
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-verification-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "node_modules/typescript/bin"), {
      recursive: true,
    }),
    mkdir(path.join(workspaceRoot, "node_modules/vitest"), {
      recursive: true,
    }),
    mkdir(path.join(workspaceRoot, "node_modules/prettier/bin"), {
      recursive: true,
    }),
    mkdir(path.join(workspaceRoot, "packages/example/test"), {
      recursive: true,
    }),
  ]);
  await Promise.all([
    writeFile(
      path.join(workspaceRoot, "node_modules/typescript/bin/tsc"),
      "// fixture\n",
    ),
    writeFile(
      path.join(workspaceRoot, "node_modules/vitest/vitest.mjs"),
      "// fixture\n",
    ),
    writeFile(
      path.join(workspaceRoot, "node_modules/prettier/bin/prettier.cjs"),
      "// fixture\n",
    ),
    writeFile(
      path.join(workspaceRoot, "packages/example/tsconfig.json"),
      "{}\n",
    ),
    writeFile(
      path.join(workspaceRoot, "packages/example/test/example.test.ts"),
      "export {};\n",
    ),
  ]);
  return { root, workspaceRoot };
}

function createFakeSandbox(
  options: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    hang?: boolean;
  } = {},
) {
  const launchRequests: SandboxLaunchRequest[] = [];
  const terminate = vi.fn<() => Promise<void>>();
  const sandbox: OsSandboxAdapter = {
    id: "fake-verification-sandbox",
    async launch(request) {
      launchRequests.push(structuredClone(request));
      const stdin = new PassThrough();
      const stdout = new PassThrough();
      const stderr = new PassThrough();
      let settled = false;
      let resolveExit:
        | ((value: {
            code: number | null;
            signal: NodeJS.Signals | null;
          }) => void)
        | undefined;
      const exit = new Promise<{
        code: number | null;
        signal: NodeJS.Signals | null;
      }>((resolve) => {
        resolveExit = resolve;
      });
      const settle = (
        code: number | null,
        signal: NodeJS.Signals | null,
      ): void => {
        if (settled) return;
        settled = true;
        stdout.end();
        stderr.end();
        resolveExit?.({ code, signal });
      };
      terminate.mockImplementation(async () => {
        settle(null, "SIGTERM");
      });
      if (!options.hang) {
        setTimeout(() => {
          if (options.stdout) stdout.write(options.stdout);
          if (options.stderr) stderr.write(options.stderr);
          settle(options.exitCode ?? 0, null);
        }, 0);
      }
      const process: SandboxedProcess = {
        stdin,
        stdout,
        stderr,
        exit,
        terminate,
      };
      return process;
    },
  };
  return { sandbox, launchRequests, terminate };
}

describe("sandboxed workspace verification", () => {
  it("runs typecheck with fixed Node arguments and read-only offline capabilities", async () => {
    const { workspaceRoot } = await createWorkspace();
    const fake = createFakeSandbox({ stdout: "typecheck passed\n" });
    const runner = new VerificationRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
    });

    const result = await runner.run({
      kind: "typecheck",
      cwd: "packages/example",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        kind: "typecheck",
        status: "passed",
        sandbox: "fake-verification-sandbox",
        cwd: "packages/example",
        target: "packages/example/tsconfig.json",
        cwdPathSha256: createHash("sha256")
          .update("packages/example")
          .digest("hex"),
        targetPathSha256: createHash("sha256")
          .update("packages/example/tsconfig.json")
          .digest("hex"),
        targetKind: "file",
        targetSnapshotSha256: createHash("sha256").update("{}\n").digest("hex"),
        targetSnapshotFileCount: 1,
        targetSnapshotBytes: 3,
        targetSnapshotTruncated: false,
        verifierPathSha256: createHash("sha256")
          .update("node_modules/typescript/bin/tsc")
          .digest("hex"),
        verifierSha256: createHash("sha256")
          .update("// fixture\n")
          .digest("hex"),
        workspaceSnapshotFileCount: 2,
        workspaceSnapshotBytes: 14,
        workspaceSnapshotTruncated: false,
        exitCode: 0,
        signal: null,
        stdoutSha256: createHash("sha256")
          .update("typecheck passed\n")
          .digest("hex"),
      }),
    );
    expect(result.details.scopeSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(result.details.workspaceSnapshotSha256).toMatch(/^[a-f0-9]{64}$/);
    expect(fake.launchRequests).toHaveLength(1);
    const request = fake.launchRequests[0]!;
    expect(request.command).toBe(await realpath(process.execPath));
    expect(request.args).toEqual([
      await realpath(
        path.join(workspaceRoot, "node_modules/typescript/bin/tsc"),
      ),
      "-p",
      await realpath(
        path.join(workspaceRoot, "packages/example/tsconfig.json"),
      ),
      "--noEmit",
      "--pretty",
      "false",
    ]);
    expect(request.env).toEqual({
      CI: "1",
      FORCE_COLOR: "0",
      NO_COLOR: "1",
    });
    expect(request.approvedCapabilities).toEqual([
      "process.spawn",
      "workspace.read",
    ]);
    expect(JSON.stringify(request)).not.toContain("network.connect");
    expect(JSON.stringify(request)).not.toContain("workspace.write");
  });

  it("returns non-zero verification as structured failure evidence", async () => {
    const { workspaceRoot } = await createWorkspace();
    const fake = createFakeSandbox({
      stderr: "src/index.ts(1,1): error TS1000\n",
      exitCode: 2,
    });
    const tool = createVerificationTool({
      workspaceRoot,
      sandbox: fake.sandbox,
    });

    const result = await tool.execute("verify-typecheck", {
      kind: "typecheck",
      cwd: "packages/example",
      timeoutMs: 5_000,
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "failed",
        exitCode: 2,
        stderrChars: 32,
      }),
    );
    expect(result.content[0]).toEqual(
      expect.objectContaining({
        type: "text",
        text: expect.stringContaining("Verification FAILED: typecheck"),
      }),
    );
    expect(result.content[0]?.text).toContain("Scope SHA-256:");
    expect(result.content[0]?.text).toContain("Workspace snapshot SHA-256:");
    expect(result.content[0]?.text).toContain("error TS1000");
  });

  it("terminates a verifier that exceeds its time budget", async () => {
    const { workspaceRoot } = await createWorkspace();
    const fake = createFakeSandbox({ hang: true });
    const runner = new VerificationRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
    });

    const result = await runner.run({
      kind: "test",
      cwd: "packages/example",
      timeoutMs: 1_000,
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "timed_out",
        signal: "SIGTERM",
      }),
    );
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  it("terminates and truncates output beyond the fixed budget", async () => {
    const { workspaceRoot } = await createWorkspace();
    const fake = createFakeSandbox({ stdout: "x".repeat(40_000) });
    const runner = new VerificationRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
    });

    const result = await runner.run({
      kind: "format",
      cwd: "packages/example",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        status: "output_capped",
        stdoutChars: 32_000,
        stdoutTruncated: true,
      }),
    );
    expect(result.stdout).toHaveLength(32_000);
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  it("propagates cancellation after terminating the child", async () => {
    const { workspaceRoot } = await createWorkspace();
    const fake = createFakeSandbox({ hang: true });
    const runner = new VerificationRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
    });
    const controller = new AbortController();
    controller.abort();

    await expect(
      runner.run(
        {
          kind: "test",
          cwd: "packages/example",
        },
        controller.signal,
      ),
    ).rejects.toThrow("verification was aborted");
    expect(fake.terminate).toHaveBeenCalledOnce();
  });

  it("rejects path escape and unsupported platforms before execution", async () => {
    const { root, workspaceRoot } = await createWorkspace();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(workspaceRoot, "outside-link"));
    const fake = createFakeSandbox();
    const runner = new VerificationRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
    });

    await expect(
      runner.run({
        kind: "test",
        cwd: "outside-link",
      }),
    ).rejects.toThrow("resolves outside");
    await expect(
      runner.run({
        kind: "toString" as "test",
      }),
    ).rejects.toThrow("Unsupported verification kind");
    expect(fake.launchRequests).toHaveLength(0);

    const unsupported = new VerificationRunner({
      workspaceRoot,
      sandbox: new UnsupportedSandboxAdapter("test-platform"),
    });
    await expect(
      unsupported.run({
        kind: "format",
        cwd: "packages/example",
      }),
    ).rejects.toThrow("No OS sandbox adapter is available");
  });
});
