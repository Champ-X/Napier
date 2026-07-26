import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";

import { describe, expect, it } from "vitest";
import { vi } from "vitest";

import {
  buildLinuxBubblewrapArgs,
  buildMacOsSandboxProfile,
  buildOciContainerArgs,
  createPlatformSandboxAdapter,
  LinuxBubblewrapSandboxAdapter,
  MacOsSandboxAdapter,
  OciContainerSandboxAdapter,
} from "../src/sandbox.js";

const BASE_REQUEST = {
  command: "/opt/napier/bin/mcp-server",
  args: ["--stdio"],
  cwd: "/workspace",
  env: {},
  workspaceRoot: "/workspace",
  approvedCapabilities: ["process.spawn"] as const,
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
    );
    const restrictedCommand = restricted.join("\0");
    expect(restricted.slice(0, 3)).toEqual(["run", "--rm", "--init"]);
    expect(restrictedCommand).toContain("--network\0none");
    expect(restrictedCommand).toContain("--read-only");
    expect(restrictedCommand).not.toContain("/workspace");
    expect(restrictedCommand).not.toContain("transient-secret");
    expect(restrictedCommand).toContain("--env\0NAPIER_SECRET_TOKEN");
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
    ).join("\0");
    expect(writableNetwork).toContain("--network\0bridge");
    expect(writableNetwork).toContain(
      "--mount\0type=bind,source=/workspace,target=/workspace",
    );
    expect(writableNetwork).not.toContain(
      "--mount\0type=bind,source=/workspace,target=/workspace,readonly",
    );
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
      buildOciContainerArgs(
        {
          ...BASE_REQUEST,
          approvedCapabilities: ["process.spawn"],
        },
        "/tmp/napier-sandbox",
        "bad image",
      ),
    ).toThrow("OCI container sandbox image is invalid");
  });
});
