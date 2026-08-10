import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import { probeMacOsSandboxAvailability } from "../src/macos-sandbox-availability.js";
import {
  buildLinuxBubblewrapArgs,
  buildMacOsSandboxProfile,
  buildOciContainerArgs,
  createPlatformSandboxAdapter,
  LinuxBubblewrapSandboxAdapter,
  MacOsSandboxAdapter,
  OciContainerSandboxAdapter,
} from "../src/sandbox.js";
import {
  probeContainerRuntimeAvailability,
  resolveContainerExecutable,
} from "../src/sandbox-container.js";

const BASE_REQUEST = {
  command: "/opt/napier/bin/mcp-server",
  args: ["--stdio"],
  cwd: "/workspace",
  env: {},
  workspaceRoot: "/workspace",
  approvedCapabilities: ["process.spawn"] as const,
};
const OCI_CONTAINER_NAME = `napier-${"d".repeat(32)}`;
const OCI_USER_IDENTITY = {
  userId: 501,
  groupId: 20,
  identitySha256: "e".repeat(64),
};

describe("OS sandbox adapters", () => {
  it("denies network and workspace access unless separately approved", () => {
    const restricted = buildMacOsSandboxProfile(
      {
        ...BASE_REQUEST,
        approvedCapabilities: ["process.spawn"],
      },
      "/tmp/napier-sandbox",
    );
    expect(restricted).toContain("(deny default)");
    expect(restricted).toContain(
      '(allow process-exec (literal "/opt/napier/bin/mcp-server"))',
    );
    expect(restricted).not.toContain("(allow process-exec)\n");
    expect(restricted).toContain('(literal "/opt/napier/bin/mcp-server")');
    expect(restricted).toContain('(allow file-read-data (literal "/"))');
    expect(restricted).toContain(
      '(allow file-read-metadata\n  (literal "/opt")',
    );
    expect(restricted).toContain('  (literal "/workspace")');
    expect(restricted).not.toContain("network-outbound");
    expect(restricted).not.toContain(
      '(allow file-read* (subpath "/workspace"))',
    );

    const workspaceNetwork = buildMacOsSandboxProfile(
      {
        ...BASE_REQUEST,
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
          "network.connect",
        ],
      },
      "/tmp/napier-sandbox",
    );
    expect(workspaceNetwork).toContain("(allow network-outbound)");
    expect(workspaceNetwork).toContain(
      '(allow file-read* (subpath "/workspace"))',
    );
    expect(workspaceNetwork).toContain(
      '(allow file-write* (subpath "/workspace"))',
    );
    const scopedWrite = buildMacOsSandboxProfile(
      {
        ...BASE_REQUEST,
        workspaceWritePaths: ["/workspace/generated"],
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
        ],
      },
      "/tmp/napier-sandbox",
    );
    expect(scopedWrite).toContain(
      '(allow file-write* (subpath "/workspace/generated"))',
    );
    expect(scopedWrite).not.toContain(
      '(allow file-write* (subpath "/workspace"))',
    );
    const runtimeAssets = buildMacOsSandboxProfile(
      {
        ...BASE_REQUEST,
        runtimeReadPaths: ["/opt/napier/lsp", "/opt/napier/typescript"],
        approvedCapabilities: ["process.spawn", "workspace.read"],
      },
      "/tmp/napier-sandbox",
    );
    expect(runtimeAssets).toContain(
      '(allow file-read* (subpath "/opt/napier/lsp"))',
    );
    expect(runtimeAssets).toContain(
      '(allow file-read* (subpath "/opt/napier/typescript"))',
    );
    expect(runtimeAssets).toContain(
      '(allow process-exec (subpath "/opt/napier/lsp"))',
    );
    expect(runtimeAssets).toContain(
      '(allow process-exec (subpath "/opt/napier/typescript"))',
    );
  });

  it("fails closed on platforms without an implemented adapter", async () => {
    const adapter = createPlatformSandboxAdapter("test-platform");
    expect(adapter.id).toBe("unsupported");
    await expect(
      adapter.launch({
        ...BASE_REQUEST,
        approvedCapabilities: ["process.spawn"],
      }),
    ).rejects.toThrow("No OS sandbox adapter is available");
  });

  it("selects a fail-closed bubblewrap adapter on Linux", () => {
    expect(createPlatformSandboxAdapter("linux").id).toBe("linux-bubblewrap");
  });

  it("selects an OCI container adapter when Windows has an explicit image", () => {
    expect(
      createPlatformSandboxAdapter("win32", {
        containerImage: "ghcr.io/example/napier-sandbox:node22",
      }).id,
    ).toBe("oci-container");
    expect(createPlatformSandboxAdapter("win32").id).toBe("unsupported");
  });

  it("falls back to the OCI container adapter on macOS and Linux when an image is configured", () => {
    expect(
      createPlatformSandboxAdapter("darwin", {
        containerImage: "alpine:3.20",
      }).id,
    ).toBe("oci-container");
    expect(
      createPlatformSandboxAdapter("linux", {
        containerImage: "alpine:3.20",
        preferContainer: true,
      }).id,
    ).toBe("oci-container");
    expect(createPlatformSandboxAdapter("darwin").id).toBe(
      "macos-sandbox-exec",
    );
    expect(createPlatformSandboxAdapter("linux").id).toBe("linux-bubblewrap");
  });

  it("resolves a container executable from PATH and rejects missing ones", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "napier-container-bin-"));
    const executable = path.join(dir, "docker");
    await writeFile(executable, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
    await expect(resolveContainerExecutable(["docker"], dir)).resolves.toBe(
      executable,
    );
    await expect(
      resolveContainerExecutable(["docker"], path.join(dir, "empty")),
    ).resolves.toBeUndefined();
    await rm(dir, { recursive: true, force: true });
  });

  it("distinguishes a reachable container server from a CLI-only install", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "napier-container-probe-"));
    const executable = path.join(dir, "docker");
    await writeFile(executable, "#!/bin/sh\nprintf '25.0.0'\n", {
      mode: 0o755,
    });
    await expect(
      probeContainerRuntimeAvailability({
        candidates: ["docker"],
        pathValue: dir,
      }),
    ).resolves.toBe(true);
    await writeFile(executable, "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    await expect(
      probeContainerRuntimeAvailability({
        candidates: ["docker"],
        pathValue: dir,
      }),
    ).resolves.toBe(false);
    const controller = new AbortController();
    controller.abort();
    await expect(
      probeContainerRuntimeAvailability({
        candidates: ["docker"],
        pathValue: dir,
        signal: controller.signal,
      }),
    ).resolves.toBe(false);
    await rm(dir, { recursive: true, force: true });
  });

  it("fails closed when Bubblewrap is not installed", async () => {
    const adapter = new LinuxBubblewrapSandboxAdapter("/missing/napier/bwrap");
    await expect(
      adapter.launch({
        ...BASE_REQUEST,
        approvedCapabilities: ["process.spawn"],
      }),
    ).rejects.toThrow("Linux process sandbox requires Bubblewrap");
  });

  it("fails closed when the OCI runtime executable is missing", async () => {
    const adapter = new OciContainerSandboxAdapter(
      "ghcr.io/example/napier-sandbox:node22",
      { executable: "/missing/napier/docker" },
    );
    await expect(
      adapter.launch({
        ...BASE_REQUEST,
        approvedCapabilities: ["process.spawn"],
      }),
    ).rejects.toThrow("OCI container sandbox requires an executable");
  });

  it("detects a host that denies macOS sandbox profiles", async () => {
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 2_147_483_646,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcessWithoutNullStreams;
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        emitter.emit("spawn");
        setImmediate(() => {
          child.exitCode = 71;
          child.stderr.end(
            "sandbox-exec: sandbox_apply: Operation not permitted\n",
          );
          emitter.emit("exit", 71, null);
        });
      });
      return child;
    });

    await expect(
      probeMacOsSandboxAvailability(process.execPath, spawnProcess as never),
    ).rejects.toThrow(
      "macOS process sandbox is unavailable in this host environment",
    );
    expect(spawnProcess.mock.calls[0]?.[1]).toEqual(
      expect.arrayContaining(["--", "/usr/bin/true"]),
    );
  });

  it("accepts a usable macOS sandbox profile", async () => {
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 2_147_483_645,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcessWithoutNullStreams;
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => {
        emitter.emit("spawn");
        setImmediate(() => {
          child.exitCode = 0;
          child.stderr.end();
          emitter.emit("exit", 0, null);
        });
      });
      return child;
    });

    await expect(
      probeMacOsSandboxAvailability(process.execPath, spawnProcess as never),
    ).resolves.toBeUndefined();
  });

  it("bounds a stalled macOS sandbox availability probe", async () => {
    const emitter = new EventEmitter();
    const kill = vi.fn(() => {
      setImmediate(() => emitter.emit("exit", null, "SIGKILL"));
      return true;
    });
    const child = Object.assign(emitter, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 2_147_483_644,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill,
    }) as unknown as ChildProcessWithoutNullStreams;
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => emitter.emit("spawn"));
      return child;
    });

    await expect(
      probeMacOsSandboxAvailability(process.execPath, spawnProcess as never, 5),
    ).rejects.toThrow(
      "macOS process sandbox is unavailable in this host environment",
    );
    expect(kill).toHaveBeenCalledWith("SIGKILL");
  });

  it("launches sandbox wrappers in an isolated process group", async () => {
    const emitter = new EventEmitter();
    const child = Object.assign(emitter, {
      stdin: new PassThrough(),
      stdout: new PassThrough(),
      stderr: new PassThrough(),
      pid: 2_147_483_647,
      exitCode: null as number | null,
      signalCode: null as NodeJS.Signals | null,
      kill: vi.fn(() => true),
    }) as unknown as ChildProcessWithoutNullStreams;
    const spawnProcess = vi.fn(() => {
      queueMicrotask(() => emitter.emit("spawn"));
      return child;
    });
    const adapter = new MacOsSandboxAdapter(
      process.execPath,
      spawnProcess as never,
      async () => undefined,
    );

    const sandboxed = await adapter.launch({
      ...BASE_REQUEST,
      command: process.execPath,
      approvedCapabilities: ["process.spawn"],
    });

    expect(spawnProcess.mock.calls[0]?.[2]).toEqual(
      expect.objectContaining({
        detached: true,
        shell: false,
        stdio: ["pipe", "pipe", "pipe"],
      }),
    );
    child.exitCode = 0;
    child.stdout.end();
    child.stderr.end();
    emitter.emit("exit", 0, null);
    await expect(sandboxed.exit).resolves.toEqual({ code: 0, signal: null });
  });

  it("derives Linux namespaces and mounts from approved capabilities", () => {
    const restricted = buildLinuxBubblewrapArgs(
      {
        ...BASE_REQUEST,
        env: { MCP_TOKEN: "transient-secret" },
        approvedCapabilities: ["process.spawn"],
      },
      "/tmp/napier-sandbox",
    );
    const restrictedCommand = restricted.join("\0");
    expect(restricted).toContain("--unshare-all");
    expect(restricted).not.toContain("--share-net");
    expect(restrictedCommand).not.toContain("/workspace");
    expect(restrictedCommand).not.toContain("transient-secret");
    expect(restrictedCommand).toContain(
      "--ro-bind\0/opt/napier/bin/mcp-server\0/opt/napier/bin/mcp-server",
    );
    expect(restrictedCommand).toContain("--chdir\0/tmp");
    expect(restricted.slice(restricted.indexOf("--") + 1)).toEqual([
      "/opt/napier/bin/mcp-server",
      "--stdio",
    ]);

    const readOnly = buildLinuxBubblewrapArgs(
      {
        ...BASE_REQUEST,
        approvedCapabilities: ["process.spawn", "workspace.read"],
      },
      "/tmp/napier-sandbox",
    ).join("\0");
    expect(readOnly).toContain("--ro-bind\0/workspace\0/workspace");
    expect(readOnly).not.toContain("--bind\0/workspace\0/workspace");
    expect(readOnly).toContain("--chdir\0/workspace");
    const runtimeAssets = buildLinuxBubblewrapArgs(
      {
        ...BASE_REQUEST,
        runtimeReadPaths: ["/opt/napier/lsp", "/opt/napier/typescript"],
        approvedCapabilities: ["process.spawn", "workspace.read"],
      },
      "/tmp/napier-sandbox",
    ).join("\0");
    expect(runtimeAssets).toContain(
      "--ro-bind\0/opt/napier/lsp\0/opt/napier/lsp",
    );
    expect(runtimeAssets).toContain(
      "--ro-bind\0/opt/napier/typescript\0/opt/napier/typescript",
    );

    const writableNetwork = buildLinuxBubblewrapArgs(
      {
        ...BASE_REQUEST,
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
          "network.connect",
        ],
      },
      "/tmp/napier-sandbox",
    );
    expect(writableNetwork).toContain("--share-net");
    expect(writableNetwork.join("\0")).toContain(
      "--bind\0/workspace\0/workspace",
    );
    const scopedWrite = buildLinuxBubblewrapArgs(
      {
        ...BASE_REQUEST,
        workspaceWritePaths: ["/workspace/generated"],
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
        ],
      },
      "/tmp/napier-sandbox",
    ).join("\0");
    expect(scopedWrite).toContain("--ro-bind\0/workspace\0/workspace");
    expect(scopedWrite).toContain(
      "--bind\0/workspace/generated\0/workspace/generated",
    );
  });

  it("derives OCI container arguments without leaking env values", () => {
    const restricted = buildOciContainerArgs(
      {
        ...BASE_REQUEST,
        env: {
          CI: "1",
          NAPIER_SECRET_TOKEN: "transient-secret",
        },
        approvedCapabilities: ["process.spawn"],
      },
      "/tmp/napier-sandbox",
      "ghcr.io/example/napier-sandbox:node22",
      OCI_CONTAINER_NAME,
      OCI_USER_IDENTITY,
    );
    const restrictedCommand = restricted.join("\0");
    expect(restricted.slice(0, 4)).toEqual([
      "run",
      "--init",
      "--name",
      OCI_CONTAINER_NAME,
    ]);
    expect(restrictedCommand).toContain("--network\0none");
    expect(restrictedCommand).toContain(["--user", "501:20"].join("\0"));
    expect(restrictedCommand).toContain("--read-only");
    expect(restrictedCommand).toContain(
      "--tmpfs\0/tmp:rw,nosuid,nodev,size=64m,mode=1777",
    );
    expect(restrictedCommand).toContain(
      "--tmpfs\0/home/napier:rw,nosuid,nodev,size=64m,mode=0700,uid=501,gid=20",
    );
    expect(restrictedCommand).not.toContain(
      "source=/tmp/napier-sandbox,target=/tmp",
    );
    expect(restrictedCommand).not.toContain("/workspace");
    expect(restrictedCommand).not.toContain("transient-secret");
    expect(restrictedCommand).toContain(
      "--env-file\0/tmp/napier-sandbox/environment.list",
    );
    expect(restrictedCommand).not.toContain("NAPIER_SECRET_TOKEN");
    expect(
      restricted.slice(
        restricted.indexOf("ghcr.io/example/napier-sandbox:node22"),
      ),
    ).toEqual([
      "ghcr.io/example/napier-sandbox:node22",
      "/opt/napier/bin/mcp-server",
      "--stdio",
    ]);

    const writableNetwork = buildOciContainerArgs(
      {
        ...BASE_REQUEST,
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
          "network.connect",
        ],
      },
      "/tmp/napier-sandbox",
      "ghcr.io/example/napier-sandbox:node22",
      OCI_CONTAINER_NAME,
      OCI_USER_IDENTITY,
    ).join("\0");
    expect(writableNetwork).toContain("--network\0bridge");
    expect(writableNetwork).toContain(
      "--mount\0type=bind,source=/workspace,target=/workspace",
    );
    expect(writableNetwork).not.toContain(
      "--mount\0type=bind,source=/workspace,target=/workspace,readonly",
    );
    const scopedWrite = buildOciContainerArgs(
      {
        ...BASE_REQUEST,
        workspaceWritePaths: ["/workspace/generated"],
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
        ],
      },
      "/tmp/napier-sandbox",
      "ghcr.io/example/napier-sandbox:node22",
      OCI_CONTAINER_NAME,
      OCI_USER_IDENTITY,
    ).join("\0");
    expect(scopedWrite).toContain(
      "--mount\0type=bind,source=/workspace,target=/workspace,readonly",
    );
    expect(scopedWrite).toContain(
      "--mount\0type=bind,source=/workspace/generated,target=/workspace/generated",
    );
    const runtimeAssets = buildOciContainerArgs(
      {
        ...BASE_REQUEST,
        runtimeReadPaths: ["/opt/napier/lsp"],
        approvedCapabilities: ["process.spawn", "workspace.read"],
      },
      "/tmp/napier-sandbox",
      "ghcr.io/example/napier-sandbox:node22",
      OCI_CONTAINER_NAME,
      OCI_USER_IDENTITY,
    ).join("\0");
    expect(runtimeAssets).toContain(
      "--mount\0type=bind,source=/opt/napier/lsp,target=/opt/napier/lsp,readonly",
    );
    const terminal = buildOciContainerArgs(
      {
        ...BASE_REQUEST,
        terminal: { columns: 80, rows: 24 },
        approvedCapabilities: ["process.spawn"],
      },
      "/tmp/napier-sandbox",
      "ghcr.io/example/napier-sandbox:node22",
      OCI_CONTAINER_NAME,
      OCI_USER_IDENTITY,
    ).join("\0");
    expect(terminal).toContain("--interactive\0--tty");
    expect(terminal).not.toContain("--rm");
    const openPipe = buildOciContainerArgs(
      {
        ...BASE_REQUEST,
        stdinMode: "open",
        approvedCapabilities: ["process.spawn"],
      },
      "/tmp/napier-sandbox",
      "ghcr.io/example/napier-sandbox:node22",
      OCI_CONTAINER_NAME,
      OCI_USER_IDENTITY,
    ).join("\0");
    expect(openPipe).toContain("--interactive");
    expect(openPipe).not.toContain("--tty");
  });

  it("rejects relative executables and write-only workspace access", () => {
    expect(() =>
      buildMacOsSandboxProfile(
        {
          ...BASE_REQUEST,
          command: "mcp-server",
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
      ),
    ).toThrow("absolute executable path");
    expect(() =>
      buildMacOsSandboxProfile(
        {
          ...BASE_REQUEST,
          approvedCapabilities: ["process.spawn", "workspace.write"],
        },
        "/tmp/napier-sandbox",
      ),
    ).toThrow("workspace.write requires workspace.read");
    expect(() =>
      buildMacOsSandboxProfile(
        {
          ...BASE_REQUEST,
          runtimeReadPaths: ["/"],
        },
        "/tmp/napier-sandbox",
      ),
    ).toThrow("absolute non-root paths");
    expect(() =>
      buildLinuxBubblewrapArgs(
        {
          ...BASE_REQUEST,
          runtimeReadPaths: ["relative/runtime"],
        },
        "/tmp/napier-sandbox",
      ),
    ).toThrow("absolute non-root paths");
    expect(() =>
      buildLinuxBubblewrapArgs(
        {
          ...BASE_REQUEST,
          cwd: "/outside",
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
      ),
    ).toThrow("cwd must stay inside the workspace");
    expect(() =>
      buildLinuxBubblewrapArgs(
        {
          ...BASE_REQUEST,
          workspaceWritePaths: ["/workspace/generated"],
          approvedCapabilities: ["process.spawn", "workspace.read"],
        },
        "/tmp/napier-sandbox",
      ),
    ).toThrow("require workspace.write");
    expect(() =>
      buildLinuxBubblewrapArgs(
        {
          ...BASE_REQUEST,
          workspaceWritePaths: ["/workspace"],
          approvedCapabilities: [
            "process.spawn",
            "workspace.read",
            "workspace.write",
          ],
        },
        "/tmp/napier-sandbox",
      ),
    ).toThrow("non-root workspace paths");
    expect(() =>
      buildLinuxBubblewrapArgs(
        {
          ...BASE_REQUEST,
          workspaceWritePaths: [
            "/workspace/generated",
            "/workspace/generated/nested",
          ],
          approvedCapabilities: [
            "process.spawn",
            "workspace.read",
            "workspace.write",
          ],
        },
        "/tmp/napier-sandbox",
      ),
    ).toThrow("cannot overlap");
    expect(() =>
      buildOciContainerArgs(
        {
          ...BASE_REQUEST,
          stdinMode: "open",
          terminal: { columns: 80, rows: 24 },
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
        "alpine:3.20",
        OCI_CONTAINER_NAME,
        OCI_USER_IDENTITY,
      ),
    ).toThrow("cannot be combined with PTY");
    expect(() =>
      buildOciContainerArgs(
        {
          ...BASE_REQUEST,
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
        "bad image",
        OCI_CONTAINER_NAME,
        OCI_USER_IDENTITY,
      ),
    ).toThrow("OCI container sandbox image is invalid");
    expect(() =>
      buildOciContainerArgs(
        {
          ...BASE_REQUEST,
          env: { HOME: "/host-controlled" },
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
        "alpine:3.20",
        OCI_CONTAINER_NAME,
        OCI_USER_IDENTITY,
      ),
    ).toThrow("environment name is reserved: HOME");
    expect(() =>
      buildOciContainerArgs(
        {
          ...BASE_REQUEST,
          env: { TOKEN: "line-one\nline-two" },
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
        "alpine:3.20",
        OCI_CONTAINER_NAME,
        OCI_USER_IDENTITY,
      ),
    ).toThrow("environment value is invalid: TOKEN");
    expect(() =>
      buildOciContainerArgs(
        {
          ...BASE_REQUEST,
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
        "alpine:3.20",
        "user-controlled-name",
        OCI_USER_IDENTITY,
      ),
    ).toThrow("resource identity is invalid");
    expect(() =>
      buildOciContainerArgs(
        {
          ...BASE_REQUEST,
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
        "alpine:3.20",
        OCI_CONTAINER_NAME,
        { ...OCI_USER_IDENTITY, userId: -1 },
      ),
    ).toThrow("user identity is invalid");
  });
});
