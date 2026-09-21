import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, it } from "vitest";
import {
  resolvePythonDebuggerRuntime,
  assertPythonDebuggerRuntimeCurrent,
} from "../src/python-debugger-runtime.js";
import { OciContainerSandboxAdapter } from "../src/sandbox-oci.js";
import { PythonDebuggerManager } from "../src/python-debugger.js";
import { WorkspaceProcessManager } from "../src/workspace-processes.js";
import { LocalStore } from "../src/store.js";
import { createActiveTestRun } from "./active-run-test-fixture.js";
import { sha256 } from "../src/ed25519.js";
import { sha256File } from "../src/command-runtime.js";
import { resolveContainerUserIdentity } from "../src/sandbox-container-runtime.js";
import { resolveContainerPythonDebuggerRuntime } from "../src/sandbox-container-python-debugger-runtime.js";

const exec = promisify(execFile);

it("removes its named probe container when the Docker client fails", async () => {
  const user = resolveContainerUserIdentity();
  const endpoint = "unix:///tmp/napier-probe-test.sock";
  const calls: readonly string[][] = [];
  const seen = calls as string[][];
  await expect(
    resolveContainerPythonDebuggerRuntime(
      {
        imageId: `sha256:${"a".repeat(64)}`,
        imagePlatform: "linux/arm64",
        clientExecutable: process.execPath,
        clientExecutableSha256: await sha256File(process.execPath),
        daemon: { location: "local", endpointSha256: sha256(endpoint) },
        user,
        identitySha256: "e".repeat(64),
      },
      async (_executable, args) => {
        seen.push([...args]);
        if (args[0] === "container") return "";
        if (args.includes("--name")) throw new Error("probe client timed out");
        return JSON.stringify({
          node: {
            executable: process.execPath,
            executableSha256: "b".repeat(64),
          },
          shell: null,
          git: null,
          lsp: null,
          verification: null,
          debugger: null,
          python: {
            executable: "/usr/bin/python3.13",
            executableSha256: "c".repeat(64),
            version: "3.13.5",
          },
        });
      },
      undefined,
      endpoint,
    ),
  ).rejects.toThrow("probe client timed out");
  const launch = seen.find((args) => args.includes("--name"))!;
  const name = launch[launch.indexOf("--name") + 1];
  expect(name).toMatch(/^napier-[a-f0-9]{32}$/u);
  expect(launch[launch.indexOf("--network") + 1]).toBe("none");
  expect(launch).toContain("--read-only");
  expect(seen).toContainEqual(["container", "rm", "--force", name]);
});

it("requires explicit image identity, rejects host overrides and detects changed provider bindings", async () => {
  let hash = "a".repeat(64);
  const sandbox = {
    id: "oci-container",
    launch: async () => {
      throw new Error("must not launch");
    },
    resolvePythonDebuggerRuntime: async () => ({
      runtime: "python-debugger" as const,
      isolation: "oci" as const,
      executable: "/usr/bin/python3.13",
      executableSha256: "b".repeat(64),
      pythonVersion: "3.13.5",
      debugpyRoot: "/usr/lib/python3/dist-packages/debugpy",
      debugpyVersion: "1.8.17",
      packageSha256: "c".repeat(64),
      runtimeIdentitySha256: hash,
      protocolWorkspaceRoot: "/workspace",
    }),
  };
  const options = { workspaceRoot: "/unused", sandbox };
  const runtime = await resolvePythonDebuggerRuntime(options);
  expect(runtime).toMatchObject({
    location: "provider",
    isolation: "oci",
    protocolWorkspaceRoot: "/workspace",
  });
  await expect(
    assertPythonDebuggerRuntimeCurrent(runtime, options),
  ).resolves.toBeUndefined();
  await expect(
    resolvePythonDebuggerRuntime({
      ...options,
      executables: { python: "/host/python" },
    }),
  ).rejects.toThrow("host runtime overrides");
  hash = "d".repeat(64);
  await expect(
    assertPythonDebuggerRuntimeCurrent(runtime, options),
  ).rejects.toThrow("runtime changed");
  hash = "invalid";
  await expect(resolvePythonDebuggerRuntime(options)).rejects.toThrow(
    "binding is invalid",
  );
  await expect(
    resolvePythonDebuggerRuntime({
      ...options,
      sandbox: { ...sandbox, resolvePythonDebuggerRuntime: undefined },
    }),
  ).rejects.toThrow("isolated debug transport");
});

it.runIf(process.env.NAPIER_LIVE_OCI_PYTHON_DEBUGGER === "1")(
  "runs real offline DAP with read-only workspace, denied host reads/outbound network and managed cleanup",
  async () => {
    const base = process.env.NAPIER_TEST_OCI_ROOT ?? tmpdir();
    await mkdir(base, { recursive: true });
    const root = await mkdtemp(path.join(base, "napier-oci-python-debug-"));
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const sentinel = path.join(root, "outside-secret.txt");
    await writeFile(sentinel, "HOST_PRIVATE_SENTINEL");
    const source = [
      "from pathlib import Path",
      "import socket",
      "write_denied = network_denied = host_read_denied = False",
      "try:",
      "    Path('forbidden.txt').write_text('must not appear')",
      "except OSError:",
      "    write_denied = True",
      "try:",
      `    Path(${JSON.stringify(sentinel)}).read_text()`,
      "except OSError:",
      "    host_read_denied = True",
      "try:",
      "    socket.create_connection(('1.1.1.1', 443), timeout=0.2)",
      "except OSError:",
      "    network_denied = True",
      "marker = 17",
      "print(marker)",
      "",
    ].join("\n");
    await writeFile(path.join(workspaceRoot, "target.py"), source);
    const store = new LocalStore({
      workspaceRoot,
      dataRoot: path.join(root, "data"),
    });
    await store.initialize();
    const { run, thread } = await createActiveTestRun(
      store,
      "Isolated Python DAP",
    );
    const owner = { runId: run.id, threadId: thread.id };
    const image = process.env.NAPIER_TEST_PYTHON_DEBUGGER_IMAGE!;
    expect(image).toMatch(/^sha256:[a-f0-9]{64}$/u);
    const sandbox = new OciContainerSandboxAdapter(image);
    const processes = new WorkspaceProcessManager({
      workspaceRoot,
      sandbox,
      store,
      dataRoot: path.join(root, "data"),
    });
    await processes.initialize();
    const manager = new PythonDebuggerManager(processes, {
      workspaceRoot,
      sandbox,
    });
    try {
      const launched = await manager.launch({
        ...owner,
        path: "target.py",
        breakpoints: [{ line: 16 }],
      });
      expect(launched).toMatchObject({
        state: "paused",
        sandbox: "oci-container",
        isolation: "oci",
      });
      const request = { ...owner, processId: launched.processId };
      const stack = await manager.execute({
        ...request,
        action: "stack_trace",
      });
      const frame = (
        stack.data as { stackFrames: Array<{ id: number; line: number }> }
      ).stackFrames[0]!;
      expect(frame.line).toBe(16);
      const checked = await manager.execute({
        ...request,
        action: "evaluate",
        frameId: frame.id,
        expression: "write_denied and network_denied and host_read_denied",
      });
      expect(checked.data).toMatchObject({ result: "True" });
      const { stdout } = await exec("docker", [
        "ps",
        "--filter",
        "name=^napier-",
        "--format",
        "{{.ID}}",
      ]);
      const containers = stdout.trim().split(/\s+/u).filter(Boolean);
      const inspected = JSON.parse(
        (await exec("docker", ["inspect", ...containers])).stdout,
      ) as Array<Record<string, any>>;
      const owned = inspected.find(
        (c) =>
          c.Image === image &&
          c.Mounts.some((m: any) =>
            m.Source.endsWith(path.basename(root) + "/workspace"),
          ),
      );
      expect(owned?.HostConfig).toMatchObject({
        NetworkMode: "none",
        ReadonlyRootfs: true,
        CapDrop: ["ALL"],
      });
      expect(
        owned?.Mounts.filter((m: any) => m.Type === "bind").every(
          (m: any) => !m.RW,
        ),
      ).toBe(true);
      const ended = await manager.execute({ ...request, action: "continue" });
      expect(ended).toMatchObject({ state: "terminated", debuggeeExitCode: 0 });
      expect(
        (await processes.list(thread.id)).every((s) => s.status !== "running"),
      ).toBe(true);
      expect(await readFile(sentinel, "utf8")).toBe("HOST_PRIVATE_SENTINEL");
      await expect(
        readFile(path.join(workspaceRoot, "forbidden.txt")),
      ).rejects.toThrow();
      const events = await store.listRunEvents(run.id);
      expect(JSON.stringify(events)).not.toContain("HOST_PRIVATE_SENTINEL");
      await expect(exec("docker", ["inspect", owned!.Id])).rejects.toThrow();
    } finally {
      await manager.cancelRun(owner);
      await processes.shutdown();
      store.close();
      await rm(root, { recursive: true, force: true });
    }
  },
  90000,
);
