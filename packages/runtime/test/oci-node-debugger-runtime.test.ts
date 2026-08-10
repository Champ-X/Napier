import { execFile } from "node:child_process";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import { sha256File } from "../src/command-execution.js";
import type { ContainerClient } from "../src/sandbox-container-runtime.js";
import { probeDapRuntime } from "../src/doctor-runtime-probes.js";
import { NodeDebuggerManager } from "../src/node-debugger.js";
import { OciContainerSandboxAdapter } from "../src/sandbox.js";
import { LocalStore } from "../src/store.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";

const execFileAsync = promisify(execFile);
const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const REQUESTED_IMAGE = "ghcr.io/example/napier-sandbox:node24-debugger";
const temporaryRoots: string[] = [];
const openProcesses: WorkspaceProcessManager[] = [];
const openStores: LocalStore[] = [];
const posixIt = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.allSettled(
    openProcesses.splice(0).map((processes) => processes.shutdown()),
  );
  for (const store of openStores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI image-bound Node debugger runtime", () => {
  posixIt(
    "runs real DAP and Doctor through the identity-bound image runtime without host mounts",
    async () => {
      const fixture = await createOciFixture();

      const launched = await fixture.debuggerManager.launch({
        threadId: fixture.threadId,
        runId: fixture.runId,
        path: "src/debug-target.mjs",
        breakpoints: [{ line: 2 }],
        actionTimeoutMs: 3_000,
        sessionTimeoutMs: 20_000,
      });
      expect(launched).toEqual(
        expect.objectContaining({
          state: "paused",
          reason: "breakpoint",
          nodeVersion: process.versions.node,
          runtimeExecutableSha256: fixture.nodeSha256,
          runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          runtimeCommandSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      const evaluated = await fixture.debuggerManager.evaluate({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: launched.processId,
        frameId: launched.frames[0]!.id,
        expression: "input",
      });
      expect(evaluated.evaluation).toEqual(
        expect.objectContaining({ status: "ok", result: "20" }),
      );
      const completed = await fixture.debuggerManager.resume({
        threadId: fixture.threadId,
        runId: fixture.runId,
        processId: launched.processId,
        action: "continue",
      });
      expect(completed).toEqual(
        expect.objectContaining({ state: "terminated", exitCode: 0 }),
      );

      const doctorSandbox = await createOciSandbox(
        fixture.root,
        fixture.workspaceRoot,
      );
      await expect(
        probeDapRuntime(fixture.workspaceRoot, undefined, doctorSandbox),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "ready",
          code: "dap_ready",
          evidence: expect.objectContaining({
            adapter: "oci-container",
            productionCall: true,
            runtimeLocation: "provider",
            nodeVersion: process.versions.node,
            nodeExecutableSha256: fixture.nodeSha256,
            runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
            inspectorWorkerProbe: true,
          }),
        }),
      );
    },
    30_000,
  );

  posixIt(
    "fails closed for missing or malformed image capability and host executable overrides",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "napier-oci-debugger-"));
      temporaryRoots.push(root);
      const workspaceRoot = path.join(root, "workspace");
      await mkdir(path.join(workspaceRoot, "src"), { recursive: true });
      await writeFile(
        path.join(workspaceRoot, "src/debug-target.mjs"),
        debugSource(),
      );
      const fakeClient = path.join(root, "fake-container-client");
      await writeFile(fakeClient, fakeContainerClientSource(workspaceRoot), {
        mode: 0o755,
      });
      const nodeSha256 = await sha256File(await realpath(process.execPath));

      const missing = sandboxWithIdentityClient(
        fakeClient,
        staticIdentityClient(nodeSha256, null),
      );
      const missingFixture = await createManager(workspaceRoot, missing);
      await expect(
        missingFixture.debuggerManager.launch({
          threadId: missingFixture.threadId,
          runId: missingFixture.runId,
          path: "src/debug-target.mjs",
          breakpoints: [{ line: 2 }],
        }),
      ).rejects.toThrow("image-bound Node debugger runtime is unavailable");
      await expect(
        probeDapRuntime(workspaceRoot, undefined, missing),
      ).resolves.toEqual(
        expect.objectContaining({ status: "unavailable", code: "dap_missing" }),
      );

      const malformed = sandboxWithIdentityClient(
        fakeClient,
        staticIdentityClient(nodeSha256, { nodeVersion: "not-a-version" }),
      );
      await expect(
        probeDapRuntime(workspaceRoot, undefined, malformed),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "unavailable",
          code: "dap_provider_unavailable",
        }),
      );

      const bound = sandboxWithIdentityClient(
        fakeClient,
        staticIdentityClient(nodeSha256, {
          nodeVersion: process.versions.node,
        }),
      );
      const overrideFixture = await createManager(workspaceRoot, bound, {
        node: process.execPath,
      });
      await expect(
        overrideFixture.debuggerManager.launch({
          threadId: overrideFixture.threadId,
          runId: overrideFixture.runId,
          path: "src/debug-target.mjs",
          breakpoints: [{ line: 2 }],
        }),
      ).rejects.toThrow("does not accept host asset overrides");
    },
    20_000,
  );
});

async function createOciFixture(): Promise<
  Awaited<ReturnType<typeof createManager>> & {
    root: string;
    nodeSha256: string;
  }
> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-oci-debugger-"));
  temporaryRoots.push(root);
  const workspaceDirectory = path.join(root, "workspace");
  await mkdir(path.join(workspaceDirectory, "src"), { recursive: true });
  const workspaceRoot = await realpath(workspaceDirectory);
  await writeFile(
    path.join(workspaceRoot, "src/debug-target.mjs"),
    debugSource(),
  );
  const sandbox = await createOciSandbox(root, workspaceRoot);
  return {
    root,
    nodeSha256: await sha256File(await realpath(process.execPath)),
    ...(await createManager(workspaceRoot, sandbox)),
  };
}

async function createOciSandbox(
  root: string,
  workspaceRoot: string,
): Promise<OciContainerSandboxAdapter> {
  const fakeClient = path.join(
    root,
    `fake-container-client-${Math.random().toString(16).slice(2)}`,
  );
  await writeFile(fakeClient, fakeContainerClientSource(workspaceRoot), {
    mode: 0o755,
  });
  return sandboxWithIdentityClient(fakeClient, realIdentityClient());
}

function sandboxWithIdentityClient(
  executable: string,
  containerClient: ContainerClient,
): OciContainerSandboxAdapter {
  return new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
    executable,
    containerClient,
    userIds: { userId: process.getuid!(), groupId: process.getgid!() },
    daemonEndpoint: "unix:///controlled/docker.sock",
  });
}

async function createManager(
  workspaceRoot: string,
  sandbox: OciContainerSandboxAdapter,
  executables?: { node: string },
): Promise<{
  workspaceRoot: string;
  store: LocalStore;
  processes: WorkspaceProcessManager;
  debuggerManager: NodeDebuggerManager;
  threadId: string;
  runId: string;
}> {
  const dataRoot = await mkdtemp(
    path.join(tmpdir(), "napier-oci-debugger-data-"),
  );
  temporaryRoots.push(dataRoot);
  const store = new LocalStore({ workspaceRoot, dataRoot });
  await store.initialize();
  openStores.push(store);
  const processes = new WorkspaceProcessManager({
    store,
    workspaceRoot,
    sandbox,
    ...(executables ? { executables } : {}),
  });
  await processes.initialize();
  openProcesses.push(processes);
  const thread = store.listThreads()[0]!;
  const run = store.listRuns(thread.id)[0]!;
  return {
    workspaceRoot,
    store,
    processes,
    debuggerManager: new NodeDebuggerManager(processes, workspaceRoot),
    threadId: thread.id,
    runId: run.id,
  };
}

function realIdentityClient(): ContainerClient {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `${IMAGE_ID}\n`;
    if (args[0] === "container") return "";
    const source = args.at(-1);
    if (args[0] !== "run" || typeof source !== "string") {
      throw new Error("unexpected controlled container client call");
    }
    if (
      args[args.indexOf("--network") + 1] !== "none" ||
      args[args.indexOf("--user") + 1] !==
        `${String(process.getuid!())}:${String(process.getgid!())}` ||
      args[args.indexOf("--pids-limit") + 1] !== "32" ||
      args[args.indexOf("--memory") + 1] !== "128m" ||
      args[args.indexOf("--cpus") + 1] !== "0.25" ||
      !args.includes("--read-only") ||
      !args.includes("no-new-privileges")
    ) {
      throw new Error("controlled identity probe policy is invalid");
    }
    const result = await execFileAsync(process.execPath, ["-e", source], {
      env: {
        CI: "1",
        LANG: "C",
        LC_ALL: "C",
        NO_COLOR: "1",
        PATH: process.env["PATH"],
      },
      maxBuffer: 8_192,
      timeout: 10_000,
    });
    if (result.stderr !== "") throw new Error(result.stderr);
    return result.stdout;
  });
}

function staticIdentityClient(
  nodeSha256: string,
  debuggerIdentity: { nodeVersion: string } | null,
): ContainerClient {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `${IMAGE_ID}\n`;
    if (args[0] === "container") return "";
    return JSON.stringify({
      node: {
        executable: process.execPath,
        executableSha256: nodeSha256,
      },
      shell: null,
      git: null,
      lsp: null,
      debugger: debuggerIdentity,
      python: null,
    });
  });
}

function debugSource(): string {
  return [
    "function calculate(input) {",
    "  const doubled = input * 2;",
    "  return doubled + 1;",
    "}",
    "globalThis.DEBUG_RESULT = calculate(20);",
  ].join("\n");
}

function fakeContainerClientSource(workspaceRoot: string): string {
  const readonlyMount = `type=bind,source=${workspaceRoot},target=${workspaceRoot},readonly`;
  const user = `${String(process.getuid!())}:${String(process.getgid!())}`;
  return [
    `#!${process.execPath}`,
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    "const args = process.argv.slice(2);",
    `const imageIndex = args.indexOf(${JSON.stringify(IMAGE_ID)});`,
    "if (imageIndex < 0) process.exit(65);",
    `if (args[imageIndex + 1] !== ${JSON.stringify(process.execPath)}) process.exit(66);`,
    "if (args[args.indexOf('--network') + 1] !== 'none') process.exit(67);",
    `if (args[args.indexOf('--user') + 1] !== ${JSON.stringify(user)}) process.exit(68);`,
    "if (args[args.indexOf('--cap-drop') + 1] !== 'ALL' || !args.includes('--read-only') || !args.includes('no-new-privileges')) process.exit(68);",
    "if (args[args.indexOf('--pids-limit') + 1] !== '256' || args[args.indexOf('--memory') + 1] !== '1g' || args[args.indexOf('--cpus') + 1] !== '2') process.exit(68);",
    "const mounts = args.flatMap((value, index) => value === '--mount' ? [args[index + 1]] : []);",
    `if (mounts.length !== 1 || mounts[0] !== ${JSON.stringify(readonlyMount)}) process.exit(69);`,
    'const envFile = args[args.indexOf("--env-file") + 1];',
    'const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").trim().split("\\n").filter(Boolean).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));',
    'const cwd = args[args.indexOf("--workdir") + 1];',
    "const child = spawn(args[imageIndex + 1], args.slice(imageIndex + 2), { cwd, env: { ...env, HOME: cwd, TMPDIR: '/tmp' }, stdio: 'inherit' });",
    'process.on("SIGTERM", () => child.kill("SIGTERM"));',
    'process.on("SIGINT", () => child.kill("SIGINT"));',
    'child.once("error", () => process.exit(70));',
    'child.once("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 71); });',
    "",
  ].join("\n");
}
