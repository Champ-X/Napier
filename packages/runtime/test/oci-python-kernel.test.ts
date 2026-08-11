import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { resolveCommandRuntimeBinding } from "../src/command-runtime.js";
import type { ContainerClient } from "../src/sandbox-container-runtime.js";
import {
  LocalStore,
  OciContainerSandboxAdapter,
  PythonKernelManager,
  WorkspaceProcessManager,
} from "../src/index.js";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const temporaryRoots: string[] = [];
const stores: LocalStore[] = [];
const processManagers: WorkspaceProcessManager[] = [];
const posixIt = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.allSettled(
    processManagers.splice(0).map((manager) => manager.shutdown()),
  );
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI image-bound Python kernel", () => {
  posixIt(
    "keeps restricted Python state through the production Process protocol",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "napier-oci-python-"));
      temporaryRoots.push(root);
      const workspaceRoot = path.join(root, "workspace");
      await mkdir(workspaceRoot);
      const hostPython = await resolveCommandRuntimeBinding("python");
      const executable = path.join(root, "fake-container-client");
      await writeFile(
        executable,
        fakeContainerClientSource(hostPython.executable),
        { mode: 0o755 },
      );
      const store = new LocalStore({
        workspaceRoot,
        dataRoot: path.join(root, "data"),
      });
      await store.initialize();
      stores.push(store);
      const sandbox = new OciContainerSandboxAdapter(
        "ghcr.io/example/napier-sandbox:node24-python",
        {
          executable,
          containerClient: identityClient(),
          userIds: { userId: process.getuid!(), groupId: process.getgid!() },
          daemonEndpoint: "unix:///controlled/docker.sock",
        },
      );
      const processes = new WorkspaceProcessManager({
        store,
        workspaceRoot,
        sandbox,
      });
      await processes.initialize();
      processManagers.push(processes);
      const thread = store.listThreads()[0]!;
      const run = store.listRuns(thread.id)[0]!;
      const kernels = new PythonKernelManager(processes);

      const session = await kernels.start({
        threadId: thread.id,
        runId: run.id,
        timeoutMs: 20_000,
      });
      const seeded = await kernels.evaluate({
        threadId: thread.id,
        runId: run.id,
        processId: session.id,
        code: "values = [3, 4, 5]\nvalues",
      });
      const reduced = await kernels.evaluate({
        threadId: thread.id,
        runId: run.id,
        processId: session.id,
        code: "sum(values)",
      });
      const cancelled = await kernels.cancel({
        threadId: thread.id,
        runId: run.id,
        processId: session.id,
      });

      expect(session).toEqual(
        expect.objectContaining({
          runtime: "python",
          status: "running",
          sandbox: "oci-container",
          executableSha256: "d".repeat(64),
          commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(seeded).toEqual(
        expect.objectContaining({
          status: "ok",
          jsonValue: [3, 4, 5],
          processStatus: "running",
        }),
      );
      expect(reduced).toEqual(
        expect.objectContaining({ status: "ok", jsonValue: 12 }),
      );
      expect(cancelled.status).toBe("cancelled");
      expect(JSON.stringify(await store.listEvents(thread.id))).not.toContain(
        "values =",
      );
    },
    20_000,
  );
});

function identityClient() {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `${IMAGE_ID}\tlinux\tarm64\n`;
    if (args[0] === "container") return "";
    return JSON.stringify({
      node: {
        executable: "/usr/local/bin/node",
        executableSha256: "b".repeat(64),
      },
      shell: {
        executable: "/bin/sh",
        executableSha256: "c".repeat(64),
      },
      git: {
        executable: "/usr/bin/git",
        executableSha256: "e".repeat(64),
        version: "git version 2.51.0",
      },
      lsp: null,
      verification: null,
      debugger: null,
      python: {
        executable: "/usr/local/bin/python3",
        executableSha256: "d".repeat(64),
        version: "3.12.8",
      },
    });
  });
}

function fakeContainerClientSource(hostPython: string): string {
  return [
    `#!${process.execPath}`,
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    "const args = process.argv.slice(2);",
    `const imageIndex = args.indexOf(${JSON.stringify(IMAGE_ID)});`,
    "if (imageIndex < 0) process.exit(65);",
    `if (args[imageIndex + 1] !== ${JSON.stringify("/usr/local/bin/python3")}) process.exit(66);`,
    'const envFile = args[args.indexOf("--env-file") + 1];',
    'const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").trim().split("\\n").filter(Boolean).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));',
    'const cwd = args[args.indexOf("--workdir") + 1];',
    `const child = spawn(${JSON.stringify(hostPython)}, args.slice(imageIndex + 2), { cwd, env, stdio: "inherit" });`,
    'process.on("SIGTERM", () => child.kill("SIGTERM"));',
    'process.on("SIGINT", () => child.kill("SIGINT"));',
    "child.once('error', () => process.exit(67));",
    "child.once('exit', (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 68); });",
    "",
  ].join("\n");
}
