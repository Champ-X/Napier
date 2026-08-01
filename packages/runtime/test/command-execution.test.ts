import { execFile } from "node:child_process";
import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rename,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommandRunner,
  prepareCommandExecution,
} from "../src/command-execution.js";
import { createCommandTool } from "../src/command-tool.js";
import type {
  OsSandboxAdapter,
  SandboxedProcess,
  SandboxLaunchRequest,
} from "../src/sandbox.js";
import { UnsupportedSandboxAdapter } from "../src/sandbox.js";

const temporaryRoots: string[] = [];
const execFileAsync = promisify(execFile);

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
  executables: {
    node: string;
  };
}> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-command-"));
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  const bin = path.join(root, "bin");
  await Promise.all([
    mkdir(path.join(workspaceRoot, "packages/example"), { recursive: true }),
    mkdir(bin, { recursive: true }),
  ]);
  await writeFile(
    path.join(workspaceRoot, "packages/example/input.txt"),
    "workspace fixture\n",
  );
  const executables = {
    node: path.join(bin, "node"),
  };
  await Promise.all(
    Object.values(executables).map(async (file) => {
      await writeFile(file, "#!/bin/sh\nexit 0\n");
      await chmod(file, 0o755);
    }),
  );
  return { root, workspaceRoot, executables };
}

function createFakeSandbox(
  options: {
    stdout?: string;
    stderr?: string;
    exitCode?: number;
    hang?: boolean;
    onLaunch?: (request: SandboxLaunchRequest) => Promise<void> | void;
  } = {},
) {
  const launchRequests: SandboxLaunchRequest[] = [];
  const terminateCalls: Array<ReturnType<typeof vi.fn>> = [];
  const sandbox: OsSandboxAdapter = {
    id: "fake-command-sandbox",
    async launch(request) {
      launchRequests.push(structuredClone(request));
      await options.onLaunch?.(request);
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
      const terminate = vi.fn(async () => settle(null, "SIGTERM"));
      terminateCalls.push(terminate);
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
  return { sandbox, launchRequests, terminateCalls };
}

describe("sandboxed command execution", () => {
  it("binds the fixed Python interpreter and runtime assets without host environment", async () => {
    const { workspaceRoot } = await createWorkspace();
    const fake = createFakeSandbox();
    const prepared = await prepareCommandExecution(
      {
        workspaceRoot,
        sandbox: fake.sandbox,
      },
      {
        runtime: "python",
        args: ["--version"],
      },
    );

    expect(prepared).toEqual(
      expect.objectContaining({
        runtime: "python",
        executable: expect.stringMatching(/python3(?:\.\d+)?$/u),
        executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        runtimeAssets: expect.arrayContaining([
          expect.objectContaining({
            path: expect.any(String),
            sha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        ]),
        launch: expect.objectContaining({
          approvedCapabilities: ["process.spawn", "workspace.read"],
          runtimeReadPaths: [expect.any(String)],
          env: {
            CI: "1",
            FORCE_COLOR: "0",
            LANG: "C",
            LC_ALL: "C",
            NO_COLOR: "1",
            PYTHONDONTWRITEBYTECODE: "1",
            PYTHONHASHSEED: "0",
            PYTHONNOUSERSITE: "1",
          },
        }),
        receipt: expect.objectContaining({
          runtimeAssetSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          workspaceAccess: "read_only",
          networkAccess: "denied",
        }),
      }),
    );
    expect(prepared.runtimeAssets.length).toBeGreaterThanOrEqual(40);
    expect(prepared.runtimeAssets.length).toBeLessThanOrEqual(128);
    expect(
      prepared.runtimeAssets.some((asset) => asset.path.endsWith("/os.py")),
    ).toBe(true);
    expect(
      prepared.runtimeAssets.some((asset) =>
        asset.path.endsWith("/tracemalloc.py"),
      ),
    ).toBe(true);
    const { stdout } = await execFileAsync(
      prepared.executable,
      [
        "-I",
        "-B",
        "-S",
        "-c",
        [
          "import ast,base64,builtins,json,os,resource,signal,sys,threading,time,tracemalloc,types,zlib",
          '"probe".encode("utf-16-le")',
          "paths=set()",
          '[paths.add(os.path.realpath(value)) for module in sys.modules.values() for value in (getattr(module,"__file__",None),getattr(module,"__cached__",None)) if isinstance(value,str) and os.path.isfile(value)]',
          "print(json.dumps(sorted(paths)))",
        ].join(";"),
      ],
      {
        env: prepared.launch.env,
        maxBuffer: 64 * 1024,
      },
    );
    const loadedAssets = JSON.parse(stdout) as string[];
    const boundAssets = new Set(
      prepared.runtimeAssets.map((asset) => asset.path),
    );
    expect(loadedAssets.filter((asset) => !boundAssets.has(asset))).toEqual([]);
    expect(fake.launchRequests).toEqual([]);
  });

  it("runs explicit argv with read-only offline capabilities and no inherited secrets", async () => {
    const { root, workspaceRoot, executables } = await createWorkspace();
    const toolchain = path.join(root, "toolchain");
    await mkdir(toolchain);
    const fake = createFakeSandbox({ stdout: "42\n" });
    const runner = new CommandRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
      runtimeReadPaths: [toolchain],
    });

    const result = await runner.run({
      runtime: "node",
      args: ["-e", "console.log(21 * 2)", "; touch SHOULD_NOT_EXIST"],
      cwd: "packages/example",
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        runtime: "node",
        status: "succeeded",
        sandbox: "fake-command-sandbox",
        workspaceAccess: "read_only",
        networkAccess: "denied",
        argumentCount: 3,
        exitCode: 0,
        stdoutChars: 3,
        commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        argumentSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        environmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        runtimeReadPathSetSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
        resourceLimitsSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    const request = fake.launchRequests[0]!;
    const resolvedNodeExecutable = await realpath(executables.node);
    expect(request.command).toBe(resolvedNodeExecutable);
    expect(request.args).toEqual([
      "-e",
      "console.log(21 * 2)",
      "; touch SHOULD_NOT_EXIST",
    ]);
    expect(request.approvedCapabilities).toEqual([
      "process.spawn",
      "workspace.read",
    ]);
    expect(request.runtimeReadPaths).toEqual([await realpath(toolchain)]);
    expect(JSON.stringify(request)).not.toContain("network.connect");
    expect(JSON.stringify(request)).not.toContain("workspace.write");
    expect(JSON.stringify(request)).not.toContain("NAPIER_LIVE");
    expect(request.env).toEqual(
      expect.objectContaining({
        CI: "1",
        FORCE_COLOR: "0",
        NO_COLOR: "1",
      }),
    );
  });

  it("returns non-zero, timeout, and output-cap outcomes as structured evidence", async () => {
    const { workspaceRoot, executables } = await createWorkspace();
    const failed = createFakeSandbox({ stderr: "nope\n", exitCode: 7 });
    const failedResult = await new CommandRunner({
      workspaceRoot,
      sandbox: failed.sandbox,
      executables,
    }).run({ runtime: "node", args: ["--version"] });
    expect(failedResult.details).toEqual(
      expect.objectContaining({
        status: "failed",
        exitCode: 7,
        stderrChars: 5,
      }),
    );

    const timedOut = createFakeSandbox({ hang: true });
    const timedOutResult = await new CommandRunner({
      workspaceRoot,
      sandbox: timedOut.sandbox,
      executables,
    }).run({
      runtime: "node",
      args: ["-e", "setInterval(() => {}, 1000)"],
      timeoutMs: 1_000,
    });
    expect(timedOutResult.details.status).toBe("timed_out");
    expect(timedOut.terminateCalls[0]).toHaveBeenCalledOnce();

    const capped = createFakeSandbox({ stdout: "x".repeat(40_000) });
    const cappedResult = await new CommandRunner({
      workspaceRoot,
      sandbox: capped.sandbox,
      executables,
    }).run({ runtime: "node", args: ["-e", "print"] });
    expect(cappedResult.details).toEqual(
      expect.objectContaining({
        status: "output_capped",
        stdoutChars: 32_000,
        stdoutTruncated: true,
      }),
    );
    expect(capped.terminateCalls[0]).toHaveBeenCalledOnce();
  });

  it("terminates an active process when its parent Run is cancelled", async () => {
    const { workspaceRoot, executables } = await createWorkspace();
    const fake = createFakeSandbox({ hang: true });
    const runner = new CommandRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
    });
    const controller = new AbortController();
    const execution = runner.run(
      { runtime: "node", args: ["-e", "setInterval(() => {}, 1000)"] },
      controller.signal,
    );
    controller.abort();

    await expect(execution).rejects.toThrow("command execution was aborted");
    expect(fake.terminateCalls[0]).toHaveBeenCalledOnce();
  });

  it("revalidates runtime bytes after cancellation", async () => {
    const { workspaceRoot, executables } = await createWorkspace();
    const fake = createFakeSandbox({
      hang: true,
      onLaunch: async () => {
        await writeFile(executables.node, "#!/bin/sh\nexit 9\n");
        await chmod(executables.node, 0o755);
      },
    });
    const runner = new CommandRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
    });
    const controller = new AbortController();
    const execution = runner.run(
      { runtime: "node", args: ["-e", "setInterval(() => {}, 1000)"] },
      controller.signal,
    );
    await vi.waitFor(() => expect(fake.launchRequests).toHaveLength(1));
    controller.abort();

    await expect(execution).rejects.toThrow(
      "command runtime changed during execution",
    );
    expect(fake.terminateCalls[0]).toHaveBeenCalledOnce();
  });

  it("supports concurrent isolated invocations", async () => {
    const { workspaceRoot, executables } = await createWorkspace();
    const fake = createFakeSandbox({ stdout: "ok\n" });
    const runner = new CommandRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
    });

    const results = await Promise.all([
      runner.run({ runtime: "node", args: ["--version"] }),
      runner.run({
        runtime: "node",
        args: ["-e", "process.stdout.write('ok')"],
      }),
    ]);

    expect(results.map((result) => result.details.status)).toEqual([
      "succeeded",
      "succeeded",
    ]);
    expect(fake.launchRequests).toHaveLength(2);
  });

  it("fails closed when runtime bytes drift during execution", async () => {
    const { workspaceRoot, executables } = await createWorkspace();
    const fake = createFakeSandbox({
      stdout: "untrusted\n",
      onLaunch: async () => {
        await writeFile(executables.node, "#!/bin/sh\nexit 9\n");
        await chmod(executables.node, 0o755);
      },
    });
    const runner = new CommandRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
    });

    await expect(
      runner.run({ runtime: "node", args: ["--version"] }),
    ).rejects.toThrow("command runtime changed during execution");
  });

  it("fails closed when an admitted runtime read path is replaced", async () => {
    const { root, workspaceRoot, executables } = await createWorkspace();
    const toolchain = path.join(root, "toolchain");
    const replaced = path.join(root, "toolchain-replaced");
    await mkdir(toolchain);
    const fake = createFakeSandbox({
      onLaunch: async () => {
        await rename(toolchain, replaced);
        await mkdir(toolchain);
      },
    });
    const runner = new CommandRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
      runtimeReadPaths: [toolchain],
    });

    await expect(
      runner.run({ runtime: "node", args: ["--version"] }),
    ).rejects.toThrow("runtime read path changed");
  });

  it("rejects path escape, malformed argv, and unavailable runtimes before launch", async () => {
    const { root, workspaceRoot, executables } = await createWorkspace();
    const outside = path.join(root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(workspaceRoot, "outside-link"));
    const fake = createFakeSandbox();
    const runner = new CommandRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
    });

    await expect(
      runner.run({ runtime: "node", args: [], cwd: "../outside" }),
    ).rejects.toThrow("escapes the workspace");
    await expect(
      runner.run({ runtime: "node", args: [], cwd: "outside-link" }),
    ).rejects.toThrow("resolves outside");
    await expect(
      runner.run({ runtime: "node", args: ["bad\nargument"] }),
    ).rejects.toThrow("bounded explicit argv");
    await expect(
      runner.run({ runtime: "python3" as "node", args: [] }),
    ).rejects.toThrow("Unsupported command runtime");
    await expect(
      new CommandRunner({
        workspaceRoot,
        sandbox: fake.sandbox,
        executables: { node: path.join(root, "missing") },
      }).run({ runtime: "node", args: [] }),
    ).rejects.toThrow("node runtime is unavailable");
    const privateRuntimePath = path.join(root, "TOP_SECRET_RUNTIME_PATH");
    const runtimePathFailure = await new CommandRunner({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
      runtimeReadPaths: [privateRuntimePath],
    })
      .run({ runtime: "node", args: [] })
      .catch((error: unknown) => error);
    expect(runtimePathFailure).toBeInstanceOf(Error);
    expect((runtimePathFailure as Error).message).toBe(
      "command runtime read path is unavailable",
    );
    expect((runtimePathFailure as Error).message).not.toContain(
      privateRuntimePath,
    );
    expect(fake.launchRequests).toHaveLength(0);
  });

  it("fails closed on unsupported sandbox platforms", async () => {
    const { workspaceRoot, executables } = await createWorkspace();
    const runner = new CommandRunner({
      workspaceRoot,
      sandbox: new UnsupportedSandboxAdapter("test-platform"),
      executables,
    });
    await expect(
      runner.run({ runtime: "node", args: ["--version"] }),
    ).rejects.toThrow("No OS sandbox adapter is available");
  });

  it("exposes bounded output to the model while returning hash-rich details", async () => {
    const { workspaceRoot, executables } = await createWorkspace();
    const fake = createFakeSandbox({ stdout: "result\n" });
    const tool = createCommandTool({
      workspaceRoot,
      sandbox: fake.sandbox,
      executables,
    });

    const result = await tool.execute("command-1", {
      runtime: "node",
      args: ["-e", "console.log('result')"],
    });

    expect(result.details).toEqual(
      expect.objectContaining({
        runtime: "node",
        status: "succeeded",
        stdoutSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      }),
    );
    expect(result.content[0]?.text).toContain("STDOUT\nresult");
  });
});
