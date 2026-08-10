import { execFile } from "node:child_process";
import {
  access,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  runGitInspectProcess,
  runGitProcess,
} from "../src/git-inspect-process.js";
import type { ContainerClient } from "../src/sandbox-container-runtime.js";
import { OciContainerSandboxAdapter } from "../src/sandbox.js";

const execFileAsync = promisify(execFile);
const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const GIT_SHA256 = "e".repeat(64);
const REQUESTED_IMAGE = "ghcr.io/example/napier-sandbox:node24-git";
const temporaryRoots: string[] = [];
const posixIt = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI image-bound Git runtime", () => {
  posixIt(
    "inspects a repository and writes only the private staged state",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "napier-oci-git-"));
      temporaryRoots.push(root);
      const workspaceDirectory = path.join(root, "workspace");
      await mkdir(workspaceDirectory);
      const workspaceRoot = await realpath(workspaceDirectory);
      const privateRoot = path.join(workspaceRoot, "private-git-state");
      const objectDirectory = path.join(privateRoot, "objects");
      const indexFile = path.join(privateRoot, "index");
      await mkdir(objectDirectory, { recursive: true });
      await writeFile(path.join(workspaceRoot, "tracked.txt"), "staged\n");
      await execFileAsync("/usr/bin/git", ["init", "--quiet"], {
        cwd: workspaceRoot,
      });
      const fakeClient = path.join(root, "fake-container-client");
      await writeFile(
        fakeClient,
        fakeContainerClientSource(workspaceRoot, privateRoot),
        { mode: 0o755 },
      );
      const client = identityClient();
      const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
        executable: fakeClient,
        containerClient: client,
        userIds: { userId: process.getuid!(), groupId: process.getgid!() },
        daemonEndpoint: "unix:///controlled/docker.sock",
      });

      const inspected = await runGitInspectProcess(
        { workspaceRoot, sandbox },
        ["rev-parse", "--is-inside-work-tree"],
        5_000,
      );
      const staged = await runGitProcess(
        { workspaceRoot, sandbox },
        ["add", "--", "tracked.txt"],
        5_000,
        undefined,
        {
          operation: "stage",
          privateFiles: {
            indexFile,
            objectDirectory,
            alternateObjectDirectory: path.join(
              workspaceRoot,
              ".git",
              "objects",
            ),
          },
          workspaceWritePaths: [privateRoot],
        },
      );

      expect(inspected).toEqual(
        expect.objectContaining({
          stdout: "true\n",
          stderr: "",
          status: "succeeded",
          executableSha256: GIT_SHA256,
          runtimeIdentitySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      expect(staged).toEqual(
        expect.objectContaining({
          status: "succeeded",
          executableSha256: GIT_SHA256,
          runtimeIdentitySha256: inspected.runtimeIdentitySha256,
        }),
      );
      await expect(access(indexFile)).resolves.toBeUndefined();
      await expect(
        access(path.join(workspaceRoot, ".git", "index")),
      ).rejects.toThrow();
      expect(client.mock.calls[1]?.[1]).toEqual(
        expect.arrayContaining(["--user", expect.any(String), IMAGE_ID]),
      );
    },
    20_000,
  );

  it("fails closed for a missing image Git runtime or host override", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-oci-git-"));
    temporaryRoots.push(root);
    const missing = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient({ gitUnavailable: true }),
      userIds: { userId: 501, groupId: 20 },
      daemonEndpoint: "unix:///controlled/docker.sock",
    });
    await expect(
      runGitInspectProcess(
        { workspaceRoot: root, sandbox: missing },
        ["status", "--porcelain=v2"],
        5_000,
      ),
    ).rejects.toThrow("image-bound git runtime is unavailable");

    const bound = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient(),
      userIds: { userId: 501, groupId: 20 },
      daemonEndpoint: "unix:///controlled/docker.sock",
    });
    await expect(
      runGitInspectProcess(
        { workspaceRoot: root, sandbox: bound, gitExecutable: "/usr/bin/git" },
        ["status", "--porcelain=v2"],
        5_000,
      ),
    ).rejects.toThrow("does not accept a host executable override");
  });
});

function identityClient(options: { gitUnavailable?: boolean } = {}) {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `${IMAGE_ID}\n`;
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
      git: options.gitUnavailable
        ? null
        : {
            executable: "/usr/bin/git",
            executableSha256: GIT_SHA256,
            version: "git version 2.51.0",
          },
      lsp: null,
      python: {
        executable: "/usr/local/bin/python3",
        executableSha256: "d".repeat(64),
        version: "3.12.8",
      },
    });
  });
}

function fakeContainerClientSource(
  workspaceRoot: string,
  privateRoot: string,
): string {
  const readonlyMount = `type=bind,source=${workspaceRoot},target=${workspaceRoot},readonly`;
  const writableMount = `type=bind,source=${privateRoot},target=${privateRoot}`;
  return [
    `#!${process.execPath}`,
    'const { spawnSync } = require("node:child_process");',
    'const fs = require("node:fs");',
    "const args = process.argv.slice(2);",
    `const imageIndex = args.indexOf(${JSON.stringify(IMAGE_ID)});`,
    "if (imageIndex < 0) process.exit(65);",
    `if (args[imageIndex + 1] !== ${JSON.stringify("/usr/bin/git")}) process.exit(66);`,
    "const mounts = args.flatMap((value, index) => value === '--mount' ? [args[index + 1]] : []);",
    `if (!mounts.includes(${JSON.stringify(readonlyMount)})) process.exit(67);`,
    `if (args.includes("add") && !mounts.includes(${JSON.stringify(writableMount)})) process.exit(68);`,
    'const envFile = args[args.indexOf("--env-file") + 1];',
    'const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").trim().split("\\n").filter(Boolean).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));',
    'const cwd = args[args.indexOf("--workdir") + 1];',
    `const result = spawnSync(${JSON.stringify("/usr/bin/git")}, args.slice(imageIndex + 2), { cwd, env: { ...env, HOME: cwd, TMPDIR: "/tmp" }, stdio: "inherit" });`,
    "if (result.error) process.exit(69);",
    "process.exit(result.status ?? 70);",
    "",
  ].join("\n");
}
