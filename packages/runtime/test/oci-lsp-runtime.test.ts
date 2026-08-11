import { createRequire } from "node:module";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import { probeLspRuntime } from "../src/doctor-lsp-runtime-probe.js";
import type { ContainerClient } from "../src/sandbox-container-runtime.js";
import {
  LspDiagnosticsRunner,
  OciContainerSandboxAdapter,
  RunLspSessionManager,
} from "../src/index.js";

const require = createRequire(import.meta.url);
const IMAGE_ID = `sha256:${"a".repeat(64)}`;
const REQUESTED_IMAGE = "ghcr.io/example/napier-sandbox:node24-lsp";
const NODE_SHA256 = "b".repeat(64);
const LANGUAGE_SERVER_SHA256 = "e".repeat(64);
const TYPESCRIPT_SHA256 = "f".repeat(64);
const temporaryRoots: string[] = [];
const posixIt = process.platform === "win32" ? it.skip : it;

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("OCI image-bound LSP runtime", () => {
  posixIt(
    "runs real persistent diagnostics and Doctor without host runtime mounts",
    async () => {
      const root = await mkdtemp(path.join(tmpdir(), "napier-oci-lsp-"));
      temporaryRoots.push(root);
      const workspaceDirectory = path.join(root, "workspace");
      await mkdir(workspaceDirectory);
      const workspaceRoot = await realpath(workspaceDirectory);
      await writeFile(
        path.join(workspaceRoot, "target.ts"),
        "const value: string = 42;\n",
      );
      const assets = hostLspAssets();
      const fakeClient = path.join(root, "fake-container-client");
      await writeFile(
        fakeClient,
        fakeContainerClientSource(workspaceRoot, assets),
        { mode: 0o755 },
      );
      const sandbox = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
        executable: fakeClient,
        containerClient: identityClient(assets),
        userIds: { userId: process.getuid!(), groupId: process.getgid!() },
        daemonEndpoint: "unix:///controlled/docker.sock",
      });
      const manager = new RunLspSessionManager(sandbox, workspaceRoot);
      const owner = { threadId: "thread_oci_lsp", runId: "run_oci_lsp01" };
      const runner = new LspDiagnosticsRunner({
        workspaceRoot,
        sandbox,
        session: manager.forRun(owner),
      });

      try {
        const first = await runner.run({ path: "target.ts" });
        const second = await runner.run({ path: "target.ts" });

        expect(first.details).toEqual(
          expect.objectContaining({
            sandbox: "oci-container",
            status: "diagnostics",
            diagnosticCount: 1,
            nodeExecutableSha256: NODE_SHA256,
            languageServerVersion: "5.3.0",
            languageServerSha256: LANGUAGE_SERVER_SHA256,
            typescriptVersion: "5.9.3",
            typescriptServerSha256: TYPESCRIPT_SHA256,
            sessionMode: "run_persistent",
            sessionReused: false,
            sessionOperation: 1,
          }),
        );
        expect(second.details).toEqual(
          expect.objectContaining({
            sessionMode: "run_persistent",
            sessionReused: true,
            sessionOperation: 2,
            sessionIdSha256: first.details.sessionIdSha256,
            resourceLimitsSha256: first.details.resourceLimitsSha256,
          }),
        );
      } finally {
        await manager.cancelRun(owner);
      }

      await expect(
        probeLspRuntime(workspaceRoot, undefined, sandbox),
      ).resolves.toEqual(
        expect.objectContaining({
          status: "ready",
          code: "lsp_ready",
          evidence: expect.objectContaining({
            adapter: "oci-container",
            productionCall: true,
            nodeExecutableSha256: NODE_SHA256,
            languageServerSha256: LANGUAGE_SERVER_SHA256,
            typescriptServerSha256: TYPESCRIPT_SHA256,
            providerRuntimeIdentitySha256:
              expect.stringMatching(/^[a-f0-9]{64}$/u),
          }),
        }),
      );
    },
    25_000,
  );

  it("fails closed for missing image assets and host runtime overrides", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-oci-lsp-"));
    temporaryRoots.push(root);
    await writeFile(path.join(root, "target.ts"), "const value = 1;\n");
    const assets = hostLspAssets();
    const missing = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient(assets, { missing: true }),
      userIds: { userId: 501, groupId: 20 },
      daemonEndpoint: "unix:///controlled/docker.sock",
    });
    await expect(
      new LspDiagnosticsRunner({ workspaceRoot: root, sandbox: missing }).run({
        path: "target.ts",
      }),
    ).rejects.toThrow("image-bound LSP runtime is unavailable");

    const bound = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient(assets),
      userIds: { userId: 501, groupId: 20 },
      daemonEndpoint: "unix:///controlled/docker.sock",
    });
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: bound,
        languageServerPath: assets.languageServerPath,
      }).run({ path: "target.ts" }),
    ).rejects.toThrow("does not accept host asset overrides");

    const malformed = new OciContainerSandboxAdapter(REQUESTED_IMAGE, {
      executable: process.execPath,
      containerClient: identityClient(assets, { outsideRoot: true }),
      userIds: { userId: 501, groupId: 20 },
      daemonEndpoint: "unix:///controlled/docker.sock",
    });
    await expect(
      new LspDiagnosticsRunner({ workspaceRoot: root, sandbox: malformed }).run(
        {
          path: "target.ts",
        },
      ),
    ).rejects.toThrow("OCI container LSP identity is invalid");
    await expect(
      new LspDiagnosticsRunner({
        workspaceRoot: root,
        sandbox: bound,
        runtimeReadPaths: [assets.languageServerRoot],
      }).run({ path: "target.ts" }),
    ).rejects.toThrow("does not accept host asset overrides");
  });
});

interface HostLspAssets {
  languageServerPath: string;
  languageServerRoot: string;
  typescriptServerPath: string;
  typescriptRoot: string;
}

function hostLspAssets(): HostLspAssets {
  const languageServerPath =
    require.resolve("typescript-language-server/lib/cli.mjs");
  const typescriptServerPath = require.resolve("typescript/lib/tsserver.js");
  return {
    languageServerPath,
    languageServerRoot: path.resolve(languageServerPath, "../.."),
    typescriptServerPath,
    typescriptRoot: path.resolve(typescriptServerPath, "../.."),
  };
}

function identityClient(
  assets: HostLspAssets,
  options: { missing?: boolean; outsideRoot?: boolean } = {},
) {
  return vi.fn<ContainerClient>(async (_executable, args) => {
    if (args[0] === "image") return `${IMAGE_ID}\tlinux\tarm64\n`;
    if (args[0] === "container") return "";
    return JSON.stringify({
      node: {
        executable: process.execPath,
        executableSha256: NODE_SHA256,
      },
      shell: null,
      git: null,
      lsp: options.missing
        ? null
        : {
            languageServerPath: assets.languageServerPath,
            languageServerRoot: options.outsideRoot
              ? "/opt/napier/node_modules/typescript-language-server"
              : assets.languageServerRoot,
            languageServerVersion: "5.3.0",
            languageServerSha256: LANGUAGE_SERVER_SHA256,
            typescriptServerPath: assets.typescriptServerPath,
            typescriptRoot: assets.typescriptRoot,
            typescriptVersion: "5.9.3",
            typescriptServerSha256: TYPESCRIPT_SHA256,
          },
      verification: null,
      debugger: null,
      python: null,
    });
  });
}

function fakeContainerClientSource(
  workspaceRoot: string,
  assets: HostLspAssets,
): string {
  const readonlyMount = `type=bind,source=${workspaceRoot},target=${workspaceRoot},readonly`;
  return [
    `#!${process.execPath}`,
    'const { spawn } = require("node:child_process");',
    'const fs = require("node:fs");',
    "const args = process.argv.slice(2);",
    `const imageIndex = args.indexOf(${JSON.stringify(IMAGE_ID)});`,
    "if (imageIndex < 0) process.exit(65);",
    `if (args[imageIndex + 1] !== ${JSON.stringify(process.execPath)}) process.exit(66);`,
    "if (args.includes('--stdio') && (!args.includes('--interactive') || args.includes('--tty'))) process.exit(71);",
    "const mounts = args.flatMap((value, index) => value === '--mount' ? [args[index + 1]] : []);",
    `if (mounts.length !== 1 || mounts[0] !== ${JSON.stringify(readonlyMount)}) process.exit(67);`,
    `if (mounts.some((mount) => mount.includes(${JSON.stringify(assets.languageServerRoot)}) || mount.includes(${JSON.stringify(assets.typescriptRoot)}))) process.exit(68);`,
    'const envFile = args[args.indexOf("--env-file") + 1];',
    'const env = Object.fromEntries(fs.readFileSync(envFile, "utf8").trim().split("\\n").filter(Boolean).map((line) => { const index = line.indexOf("="); return [line.slice(0, index), line.slice(index + 1)]; }));',
    'const cwd = args[args.indexOf("--workdir") + 1];',
    "const child = spawn(args[imageIndex + 1], args.slice(imageIndex + 2), { cwd, env: { ...env, HOME: cwd, TMPDIR: '/tmp' }, stdio: 'inherit' });",
    'process.on("SIGTERM", () => child.kill("SIGTERM"));',
    'process.on("SIGINT", () => child.kill("SIGINT"));',
    'child.once("error", () => process.exit(69));',
    'child.once("exit", (code, signal) => { if (signal) process.kill(process.pid, signal); else process.exit(code ?? 70); });',
    "",
  ].join("\n");
}
