import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, readFileSync, statSync } from "node:fs";
import {
  mkdir,
  mkdtemp,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough } from "node:stream";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  CommandRunner,
  prepareCommandExecution,
} from "../src/command-execution.js";
import { resolveCommandRuntimeBinding } from "../src/command-runtime.js";
import {
  probePythonRuntime,
  probeSandboxProcessRuntime,
  probeShellRuntime,
} from "../src/doctor-runtime-probes.js";
import { OciContainerSandboxAdapter } from "../src/sandbox.js";
import {
  assertContainerImageIdentityStable,
  resolveContainerDaemonIdentity,
  resolveContainerImageIdentity,
  resolveContainerUserIdentity,
  type ContainerClient,
} from "../src/sandbox-container-runtime.js";
import { PROCESS_GUARDIAN_SPEC_ENV } from "../src/process-guardian-worker-source.js";
import { bindWorkspaceProcessIo } from "../src/workspace-process-terminal.js";

const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const NODE_SHA256 = "b".repeat(64);
const SHELL_SHA256 = "c".repeat(64);
const PYTHON_SHA256 = "d".repeat(64);
const GIT_SHA256 = "e".repeat(64);
const REQUESTED_IMAGE = "ghcr.io/example/napier-sandbox:node24";
const USER_IDS = { userId: 501, groupId: 20 } as const;
const DAEMON_ENDPOINT = "unix:///controlled/docker.sock";
const temporaryRoots: string[] = [];
const posixIt = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI image-bound command runtime", () => {
  it("accepts only hashed local daemon endpoints", async () => {
    const client = identityClient();
    const unix = await resolveContainerDaemonIdentity(
      process.execPath,
      client,
      DAEMON_ENDPOINT,
    );
    const pipe = await resolveContainerDaemonIdentity(
      process.execPath,
      client,
      "npipe:////./pipe/docker_engine",
    );

    expect(unix).toEqual({
      location: "local",
      endpointSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(pipe.endpointSha256).not.toBe(unix.endpointSha256);
    expect(unix).not.toHaveProperty("endpoint");
    expect(client).not.toHaveBeenCalled();
    await expect(
      resolveContainerDaemonIdentity(
        process.execPath,
        client,
        "ssh://builder.example.invalid",
      ),
    ).rejects.toThrow("local Docker daemon endpoint");
    await expect(
      resolveContainerDaemonIdentity(
        process.execPath,
        client,
        "tcp://127.0.0.1:2375",
      ),
    ).rejects.toThrow("local Docker daemon endpoint");
    await expect(
      resolveContainerDaemonIdentity(
        process.execPath,
        client,
        "npipe:////remote-builder/pipe/docker_engine",
      ),
    ).rejects.toThrow("local Docker daemon endpoint");
  });

  it("validates and hashes the numeric host user identity", () => {
    const identity = resolveContainerUserIdentity(USER_IDS);

    expect(identity).toEqual({
      ...USER_IDS,
      mapping: "injected",
      identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(resolveContainerUserIdentity(USER_IDS)).toEqual(identity);
    expect(resolveContainerUserIdentity(undefined, "win32")).toEqual({
      userId: 65_532,
      groupId: 65_532,
      mapping: "portable-non-posix",
      identitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(resolveContainerUserIdentity(undefined, "linux")).toEqual(
      expect.objectContaining({
        mapping: "host-posix",
      }),
    );
    expect(() =>
      resolveContainerUserIdentity({ userId: -1, groupId: 20 }),
    ).toThrow("host user identity is unavailable");
    expect(() =>
      resolveContainerUserIdentity({
        userId: 501,
        groupId: 2_147_483_648,
      }),
    ).toThrow("host user identity is unavailable");
  });

  it("binds a supported image platform into the immutable runtime identity", async () => {
    const arm64 = await resolveContainerImageIdentity(
      REQUESTED_IMAGE,
      process.execPath,
      identityClient({ imageArch: "arm64" }),
      USER_IDS,
      DAEMON_ENDPOINT,
    );
    const amd64 = await resolveContainerImageIdentity(
      REQUESTED_IMAGE,
      process.execPath,
      identityClient({ imageArch: "amd64" }),
      USER_IDS,
      DAEMON_ENDPOINT,
    );

    expect(arm64.imagePlatform).toBe("linux/arm64");
    expect(amd64.imagePlatform).toBe("linux/amd64");
    expect(arm64.identitySha256).not.toBe(amd64.identitySha256);
    await expect(
      resolveContainerImageIdentity(
        REQUESTED_IMAGE,
        process.execPath,
        identityClient({ imageArch: "ppc64le" }),
        USER_IDS,
        DAEMON_ENDPOINT,
      ),
    ).rejects.toThrow("immutable ID");
  });

  it("rejects daemon or host user drift before reusing an image identity", async () => {
    const identity = await resolveContainerImageIdentity(
      REQUESTED_IMAGE,
      process.execPath,
      identityClient(),
      USER_IDS,
      DAEMON_ENDPOINT,
    );

    await expect(
      assertContainerImageIdentityStable(
        identity,
        identityClient(),
        USER_IDS,
        "unix:///controlled/other-docker.sock",
      ),
    ).rejects.toThrow("daemon identity changed");
    await expect(
      assertContainerImageIdentityStable(
        identity,
        identityClient(),
        { userId: 502, groupId: 20 },
        DAEMON_ENDPOINT,
      ),
    ).rejects.toThrow("host user identity changed");
  });

  it("rejects an installed Sandbox identity that no longer matches setup", async () => {
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient(),
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
      expectedIdentity: {
        clientExecutableSha256: "f".repeat(64),
        daemonEndpointSha256: "e".repeat(64),
        userIdentitySha256: "d".repeat(64),
        identitySha256: "c".repeat(64),
      },
    });

    await expect(sandbox.resolveCommandRuntime("node")).rejects.toThrow(
      "Configured Sandbox runtime identity changed",
    );
  });

  it("pins a mutable tag and runs Node argv with container runtime identity", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient();
    const { child, environmentFile, spawnProcess } =
      spawnedContainer("v24.16.0\n");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });

    const result = await new CommandRunner({ workspaceRoot, sandbox }).run({
      runtime: "node",
      args: ["--version"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        stdout: "v24.16.0\n",
        details: expect.objectContaining({
          status: "succeeded",
          sandbox: "oci-container",
          executableSha256: NODE_SHA256,
          runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const dockerArgs = spawnProcess.mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toContain(IMAGE_ID);
    expect(dockerArgs).not.toContain(REQUESTED_IMAGE);
    expect(dockerArgs).not.toContain("--rm");
    expect(dockerArgs).toEqual(
      expect.arrayContaining(["--platform", "linux/arm64"]),
    );
    expect(dockerArgs).toEqual(expect.arrayContaining(["--user", "501:20"]));
    expect(dockerArgs.join("\0")).toContain(
      "--tmpfs\0/home/napier:rw,nosuid,nodev,size=64m,mode=0700,uid=501,gid=20",
    );
    expect(dockerArgs.slice(dockerArgs.indexOf(IMAGE_ID))).toEqual([
      IMAGE_ID,
      "/usr/local/bin/node",
      "--version",
    ]);
    expect(dockerArgs.join("\0")).toContain("--network\0none");
    expect(dockerArgs.join("\0")).toContain("--env-file\0");
    expect(dockerArgs.join("\0")).toContain(
      `--mount\0type=bind,source=${workspaceRoot},target=${workspaceRoot},readonly`,
    );
    const containerName = dockerArgs[dockerArgs.indexOf("--name") + 1]!;
    expect(containerName).toMatch(/^napier-[a-f0-9]{32}$/u);
    expect(client).toHaveBeenCalledTimes(3);
    expect(client.mock.calls[0]?.[1]).toEqual([
      "image",
      "inspect",
      "--format",
      "{{.Id}}\t{{.Os}}\t{{.Architecture}}",
      REQUESTED_IMAGE,
    ]);
    expect(client.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["--network", "none", IMAGE_ID]),
    );
    expect(client.mock.calls[2]?.[1]).toEqual([
      "container",
      "rm",
      "--force",
      containerName,
    ]);
    expect(environmentFile.value).toBe(
      "CI=1\nFORCE_COLOR=0\nLANG=C\nLC_ALL=C\nNO_COLOR=1\n",
    );
    expect(environmentFile.mode).toBe(0o600);
    expect(existsSync(environmentFile.path)).toBe(false);
    const dockerEnvironment = spawnProcess.mock.calls[0]?.[2]?.env;
    expect(dockerEnvironment).not.toHaveProperty("CI");
    expect(dockerEnvironment).not.toHaveProperty("FORCE_COLOR");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("changes the runtime receipt when the numeric execution user changes", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const first = await prepareCommandExecution(
      {
        workspaceRoot,
        sandbox: new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
          executable: process.execPath,
          containerClient: identityClient(),
          userIds: USER_IDS,
          daemonEndpoint: DAEMON_ENDPOINT,
        }),
      },
      { runtime: "node", args: ["--version"] },
    );
    const second = await prepareCommandExecution(
      {
        workspaceRoot,
        sandbox: new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
          executable: process.execPath,
          containerClient: identityClient(),
          userIds: { userId: 502, groupId: 20 },
          daemonEndpoint: DAEMON_ENDPOINT,
        }),
      },
      { runtime: "node", args: ["--version"] },
    );

    expect(first.runtimeIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(second.runtimeIdentitySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(first.runtimeIdentitySha256).not.toBe(second.runtimeIdentitySha256);
  });

  it("runs Python argv through the image-bound interpreter identity", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient();
    const { environmentFile, spawnProcess } =
      spawnedContainer("Python 3.12.8\n");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });

    const result = await new CommandRunner({ workspaceRoot, sandbox }).run({
      runtime: "python",
      args: ["--version"],
    });

    expect(result).toEqual(
      expect.objectContaining({
        stdout: "Python 3.12.8\n",
        details: expect.objectContaining({
          runtime: "python",
          status: "succeeded",
          executableSha256: PYTHON_SHA256,
          runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const dockerArgs = spawnProcess.mock.calls[0]?.[1] as string[];
    expect(dockerArgs.slice(dockerArgs.indexOf(IMAGE_ID))).toEqual([
      IMAGE_ID,
      "/usr/local/bin/python3",
      "--version",
    ]);
    expect(environmentFile.value).toBe(
      "CI=1\nFORCE_COLOR=0\nLANG=C\nLC_ALL=C\nNO_COLOR=1\nPYTHONDONTWRITEBYTECODE=1\nPYTHONHASHSEED=0\nPYTHONNOUSERSITE=1\n",
    );
    expect(client.mock.calls[1]?.[1]).toEqual(
      expect.arrayContaining(["--user", "501:20", IMAGE_ID]),
    );
  });

  it("fails closed when the immutable image has no Python runtime", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient({ pythonUnavailable: true }),
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });

    await expect(
      prepareCommandExecution(
        { workspaceRoot, sandbox },
        { runtime: "python", args: ["--version"] },
      ),
    ).rejects.toThrow("image-bound python runtime is unavailable");

    const unsupported = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient({ pythonVersion: "3.8.20" }),
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });
    await expect(
      prepareCommandExecution(
        { workspaceRoot, sandbox: unsupported },
        { runtime: "python", args: ["--version"] },
      ),
    ).rejects.toThrow("Python identity is invalid");
  });

  it("lets Doctor verify the production Python path against the pinned image", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const { spawnProcess } = spawnedContainer("napier_python_probe_v1");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient(),
      spawnProcess: spawnProcess as never,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });

    await expect(
      probePythonRuntime(workspaceRoot, undefined, sandbox),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        code: "python_ready",
        evidence: expect.objectContaining({
          adapter: "oci-container",
          productionCall: true,
          pty: false,
          runtimeAssetCount: 0,
          runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const dockerArgs = spawnProcess.mock.calls[0]?.[1] as string[];
    const imageIndex = dockerArgs.indexOf(IMAGE_ID);
    expect(dockerArgs.slice(imageIndex, imageIndex + 2)).toEqual([
      IMAGE_ID,
      "/usr/local/bin/python3",
    ]);
  });

  posixIt(
    "executes the image-bound Python argv through the production pipe lifecycle",
    async () => {
      const workspaceRoot = await temporaryWorkspace();
      const hostPython = await resolveCommandRuntimeBinding("python");
      const fakeRoot = await temporaryWorkspace();
      const executable = path.join(fakeRoot, "fake-container-client");
      await writeFile(
        executable,
        [
          `#!${process.execPath}`,
          'const { spawnSync } = require("node:child_process");',
          "const args = process.argv.slice(2);",
          `const imageIndex = args.indexOf(${JSON.stringify(IMAGE_ID)});`,
          "if (imageIndex < 0) process.exit(65);",
          `if (args[imageIndex + 1] !== ${JSON.stringify("/usr/local/bin/python3")}) process.exit(66);`,
          `const result = spawnSync(${JSON.stringify(hostPython.executable)}, args.slice(imageIndex + 2), {`,
          '  stdio: "inherit",',
          "  env: { CI: '1', LANG: 'C', LC_ALL: 'C', PYTHONDONTWRITEBYTECODE: '1', PYTHONHASHSEED: '0', PYTHONNOUSERSITE: '1' },",
          "});",
          "if (result.error) process.exit(67);",
          "process.exit(result.status ?? 68);",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
        executable,
        containerClient: identityClient(),
        userIds: USER_IDS,
        daemonEndpoint: DAEMON_ENDPOINT,
      });

      const result = await new CommandRunner({ workspaceRoot, sandbox }).run({
        runtime: "python",
        args: [
          "-I",
          "-B",
          "-S",
          "-c",
          'print("napier_oci_python_probe_v1", end="")',
        ],
      });

      expect(result).toEqual(
        expect.objectContaining({
          stdout: "napier_oci_python_probe_v1",
          stderr: "",
          details: expect.objectContaining({
            status: "succeeded",
            sandbox: "oci-container",
            runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      );
    },
    15_000,
  );

  it("runs the production Shell PTY through a cleanup-bound guardian", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient();
    const { spawnProcess } = spawnedContainer("");
    const terminal = spawnedTerminal("napier_shell_probe_v1");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
      terminalLauncher: terminal.launcher,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });

    await expect(
      probeShellRuntime(workspaceRoot, undefined, sandbox),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        code: "shell_ready",
        evidence: expect.objectContaining({
          adapter: "oci-container",
          productionCall: true,
          pty: true,
          runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    expect(spawnProcess).not.toHaveBeenCalled();
    const specification = terminal.specification.value!;
    expect(specification.command).toBe(process.execPath);
    expect(specification.args).toEqual(
      expect.arrayContaining(["--interactive", "--tty", IMAGE_ID]),
    );
    expect(specification.args).not.toContain(REQUESTED_IMAGE);
    const containerName =
      specification.args[specification.args.indexOf("--name") + 1]!;
    expect(specification.cleanup).toEqual(
      expect.objectContaining({
        kind: "oci-container",
        command: process.execPath,
        commandSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        containerName,
      }),
    );
    expect(terminal.resize).not.toHaveBeenCalled();
  });

  it("lets Doctor verify the production Node pipe path against the pinned image", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient();
    const { spawnProcess } = spawnedContainer("napier_process_probe_v1");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });

    await expect(
      probeSandboxProcessRuntime(workspaceRoot, undefined, sandbox),
    ).resolves.toEqual(
      expect.objectContaining({
        status: "ready",
        code: "sandbox_process_ready",
        evidence: expect.objectContaining({
          adapter: "oci-container",
          productionCall: true,
          pty: false,
          runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    const dockerArgs = spawnProcess.mock.calls[0]?.[1] as string[];
    expect(dockerArgs).toContain(IMAGE_ID);
    expect(dockerArgs).not.toContain(REQUESTED_IMAGE);
  });

  it("fails closed when image inspection does not return an immutable ID", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = vi.fn<ContainerClient>(async () => "latest\n");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });
    await expect(
      prepareCommandExecution(
        { workspaceRoot, sandbox },
        { runtime: "node", args: ["--version"] },
      ),
    ).rejects.toThrow("immutable ID");
  });

  it("fails closed when a stopped container resource is still present", async () => {
    const workspaceRoot = await temporaryWorkspace();
    const client = identityClient({ cleanupFailure: true });
    const { spawnProcess } = spawnedContainer("v24.16.0\n");
    const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: client,
      spawnProcess: spawnProcess as never,
      userIds: USER_IDS,
      daemonEndpoint: DAEMON_ENDPOINT,
    });

    await expect(
      new CommandRunner({ workspaceRoot, sandbox }).run({
        runtime: "node",
        args: ["--version"],
      }),
    ).rejects.toThrow("OCI container resource cleanup failed");
    expect(client.mock.calls.at(-1)?.[1]).toEqual(
      expect.arrayContaining([
        "container",
        "ls",
        "--filter",
        expect.stringMatching(/^name=\^\/napier-/u),
      ]),
    );
  });

  posixIt(
    "completes the real host PTY and guardian cleanup path without an external daemon",
    async () => {
      const workspaceRoot = await temporaryWorkspace();
      const fakeRoot = await temporaryWorkspace();
      const cleanupLog = path.join(fakeRoot, "cleanup.log");
      const executable = path.join(fakeRoot, "fake-container-client");
      await writeFile(
        executable,
        [
          "#!/bin/sh",
          'if [ "$1" = "run" ]; then',
          '  printf "napier_shell_probe_v1"',
          "  exit 0",
          "fi",
          'if [ "$1" = "container" ] && [ "$2" = "rm" ]; then',
          `  printf "%s" "$4" > ${JSON.stringify(cleanupLog)}`,
          "  exit 0",
          "fi",
          'if [ "$1" = "container" ] && [ "$2" = "ls" ]; then',
          "  exit 0",
          "fi",
          "exit 64",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
        executable,
        containerClient: identityClient(),
        userIds: USER_IDS,
        daemonEndpoint: DAEMON_ENDPOINT,
      });

      await expect(
        probeShellRuntime(workspaceRoot, undefined, sandbox),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "ready",
          code: "shell_ready",
          evidence: expect.objectContaining({
            adapter: "oci-container",
            productionCall: true,
            pty: true,
          }),
        }),
      );
      await expect(readFile(cleanupLog, "utf8")).resolves.toMatch(
        /^napier-[a-f0-9]{32}$/u,
      );
    },
    15_000,
  );

  posixIt(
    "forwards PTY resize to the guarded container client process",
    async () => {
      const workspaceRoot = await temporaryWorkspace();
      const fakeRoot = await temporaryWorkspace();
      const cleanupLog = path.join(fakeRoot, "cleanup.log");
      const executable = path.join(fakeRoot, "fake-container-client");
      await writeFile(
        executable,
        [
          "#!/usr/bin/env node",
          'const fs = require("node:fs");',
          'if (process.argv[2] === "container") {',
          `  fs.writeFileSync(${JSON.stringify(cleanupLog)}, process.argv[5]);`,
          "  process.exit(0);",
          "}",
          'if (process.argv[2] !== "run") process.exit(64);',
          "const size = () => `${process.stdout.columns}x${process.stdout.rows}`;",
          "process.stdout.write(`READY:${process.stdout.isTTY}:${size()}`);",
          'process.on("SIGWINCH", () => process.stdout.write(`:SIZE:${size()}`));',
          "setInterval(() => {}, 1000);",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
        executable,
        containerClient: identityClient(),
        userIds: USER_IDS,
        daemonEndpoint: DAEMON_ENDPOINT,
      });
      const prepared = await prepareCommandExecution(
        { workspaceRoot, sandbox },
        { runtime: "shell", args: ["node --version"] },
      );
      const io = bindWorkspaceProcessIo(prepared, {
        columns: 91,
        rows: 37,
      });
      const child = await sandbox.launch(io.launch);
      let output = "";
      child.stdout.setEncoding("utf8");
      child.stdout.on("data", (chunk: string) => {
        output += chunk;
      });
      await vi.waitFor(() => {
        expect(output).toContain("READY:true:91x37");
      });

      await child.resize!(111, 43);
      await vi.waitFor(() => {
        expect(output).toContain("SIZE:111x43");
      });
      await child.terminate();
      await expect(child.exit).resolves.toEqual(
        expect.objectContaining({ code: expect.any(Number) }),
      );
      await expect(readFile(cleanupLog, "utf8")).resolves.toMatch(
        /^napier-[a-f0-9]{32}$/u,
      );
    },
    15_000,
  );

  posixIt(
    "maps a scoped writable mount to the host numeric owner",
    async () => {
      const userId = process.getuid!();
      const groupId = process.getgid!();
      const workspaceRoot = await temporaryWorkspace();
      const writeRoot = path.join(workspaceRoot, "generated");
      const outputPath = path.join(writeRoot, "owned.txt");
      await mkdir(writeRoot);
      const fakeRoot = await temporaryWorkspace();
      const executable = path.join(fakeRoot, "fake-container-client");
      await writeFile(
        executable,
        [
          "#!/usr/bin/env node",
          'const fs = require("node:fs");',
          "const args = process.argv.slice(2);",
          `if (args[args.indexOf("--user") + 1] !== ${JSON.stringify(`${String(userId)}:${String(groupId)}`)}) process.exit(65);`,
          "const mounts = args.flatMap((value, index) => value === '--mount' ? [args[index + 1]] : []);",
          `if (!mounts.includes(${JSON.stringify(`type=bind,source=${workspaceRoot},target=${workspaceRoot},readonly`)})) process.exit(66);`,
          `if (!mounts.includes(${JSON.stringify(`type=bind,source=${writeRoot},target=${writeRoot}`)})) process.exit(67);`,
          "fs.writeFileSync(args.at(-1), 'owned');",
          "",
        ].join("\n"),
        { mode: 0o755 },
      );
      const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
        executable,
        containerClient: identityClient(),
        userIds: { userId, groupId },
        daemonEndpoint: DAEMON_ENDPOINT,
      });
      const child = await sandbox.launch({
        command: "/usr/local/bin/node",
        args: [outputPath],
        cwd: workspaceRoot,
        env: {},
        workspaceRoot,
        workspaceWritePaths: [writeRoot],
        approvedCapabilities: [
          "process.spawn",
          "workspace.read",
          "workspace.write",
        ],
      });

      await expect(child.exit).resolves.toEqual({ code: 0, signal: null });
      const output = await stat(outputPath);
      expect(output.uid).toBe(userId);
      expect(output.gid).toBe(groupId);
      await expect(readFile(outputPath, "utf8")).resolves.toBe("owned");
    },
    15_000,
  );
});

function identityClient(
  options: {
    cleanupFailure?: boolean;
    imageArch?: string;
    pythonUnavailable?: boolean;
    pythonVersion?: string;
  } = {},
) {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") {
      return `${IMAGE_ID}\tlinux\t${options.imageArch ?? "arm64"}\n`;
    }
    if (args[0] === "container") {
      if (options.cleanupFailure && args[1] === "rm") {
        throw new Error("controlled cleanup failure");
      }
      return options.cleanupFailure ? `${"f".repeat(64)}\n` : "";
    }
    return JSON.stringify({
      node: {
        executable: "/usr/local/bin/node",
        executableSha256: NODE_SHA256,
      },
      shell: {
        executable: "/bin/dash",
        executableSha256: SHELL_SHA256,
      },
      git: {
        executable: "/usr/bin/git",
        executableSha256: GIT_SHA256,
        version: "git version 2.51.0",
      },
      lsp: null,
      verification: null,
      debugger: null,
      python: options.pythonUnavailable
        ? null
        : {
            executable: "/usr/local/bin/python3",
            executableSha256: PYTHON_SHA256,
            version: options.pythonVersion ?? "3.12.8",
          },
    });
  });
}

function spawnedTerminal(stdoutText: string) {
  const specification = {
    value: undefined as
      | {
          command: string;
          args: string[];
          cleanup: {
            kind: string;
            command: string;
            commandSha256: string;
            containerName: string;
          };
        }
      | undefined,
  };
  const resize = vi.fn();
  const launcher = vi.fn(async (request) => {
    specification.value = JSON.parse(
      Buffer.from(request.env[PROCESS_GUARDIAN_SPEC_ENV]!, "base64").toString(
        "utf8",
      ),
    );
    const stdin = new PassThrough();
    const stdout = new PassThrough();
    const stderr = new PassThrough();
    const completion = new Promise<{
      code: number | null;
      signal: NodeJS.Signals | null;
    }>((resolve) => {
      setImmediate(() => {
        stdout.end(stdoutText);
        stderr.end();
        resolve({ code: 0, signal: null });
      });
    });
    const exit = completion.finally(() =>
      rm(request.sandboxHome, { recursive: true, force: true }),
    );
    return {
      stdin,
      stdout,
      stderr,
      exit,
      resize,
      terminate: async () => {
        await exit;
      },
    };
  });
  return { launcher, resize, specification };
}

async function temporaryWorkspace(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-oci-command-"));
  temporaryRoots.push(root);
  return realpath(root);
}

function spawnedContainer(stdoutText: string) {
  const emitter = new EventEmitter();
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = Object.assign(emitter, {
    stdin: new PassThrough(),
    stdout,
    stderr,
    pid: 2_147_483_640,
    exitCode: null as number | null,
    signalCode: null as NodeJS.Signals | null,
    kill: vi.fn(() => true),
  }) as unknown as ChildProcessWithoutNullStreams;
  const environmentFile = { mode: 0, path: "", value: "" };
  const spawnProcess = vi.fn((_command, args: string[]) => {
    const environmentFileIndex = args.indexOf("--env-file");
    environmentFile.path = args[environmentFileIndex + 1]!;
    environmentFile.value = readFileSync(environmentFile.path, "utf8");
    environmentFile.mode = statSync(environmentFile.path).mode & 0o777;
    queueMicrotask(() => {
      emitter.emit("spawn");
      setImmediate(() => {
        stdout.end(stdoutText);
        stderr.end();
        child.exitCode = 0;
        emitter.emit("exit", 0, null);
      });
    });
    return child;
  });
  return { child, environmentFile, spawnProcess };
}
