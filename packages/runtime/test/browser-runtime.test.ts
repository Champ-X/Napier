import {
  chmod,
  mkdir,
  mkdtemp,
  realpath,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import {
  assertBrowserRuntimeCurrent,
  resolveBrowserRuntime,
} from "../src/browser-runtime.js";
import {
  inspectPinnedBrowserRuntime,
  installPinnedBrowserRuntime,
  runBrowserRuntimeInstaller,
  type PinnedBrowserRuntimeInspection,
} from "../src/browser-runtime-setup.js";
import {
  markPinnedBrowserRuntimeVerified,
  verifiedPinnedBrowserRuntimeCandidate,
} from "../src/browser-runtime-verification.js";
import { sha256 } from "../src/ed25519.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("browser runtime binding", () => {
  it("binds an allowlisted executable and rejects later identity drift", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-runtime-"));
    roots.push(root);
    const executable = path.join(root, "chrome");
    await writeFile(executable, "first executable");
    await chmod(executable, 0o755);

    const runtime = await resolveBrowserRuntime(executable);
    expect(runtime).toEqual(
      expect.objectContaining({
        executablePath: await realpath(executable),
        executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        identity: expect.objectContaining({
          size: 16,
        }),
      }),
    );
    await expect(assertBrowserRuntimeCurrent(runtime)).resolves.toBeUndefined();

    await writeFile(executable, "replacement executable");
    await expect(assertBrowserRuntimeCurrent(runtime)).rejects.toThrow(
      "changed before Session launch",
    );
  });

  it("rejects an executable outside the Chrome, Chromium, or Edge names", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-runtime-"));
    roots.push(root);
    const executable = path.join(root, "arbitrary-runner");
    await writeFile(executable, "not a browser");
    await chmod(executable, 0o755);

    await expect(resolveBrowserRuntime(executable)).rejects.toThrow(
      "No supported Chrome",
    );
  });

  it("discovers the exact Playwright-pinned Chromium target", async () => {
    const inspection = await inspectPinnedBrowserRuntime();

    expect(inspection).toEqual(
      expect.objectContaining({
        status: expect.stringMatching(/^(?:ready|installed|installable)$/u),
        target: expect.objectContaining({
          packageName: "playwright-core",
          packageVersion: "1.62.1",
          browserName: "chromium",
          browserRevision: "1234",
          browserVersion: "151.0.7922.34",
          platform: process.platform,
          arch: process.arch,
          runtimeLocationSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      }),
    );
    if (inspection.status === "ready" || inspection.status === "installed") {
      expect(inspection.runtime).toEqual(
        expect.objectContaining({
          executableSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        }),
      );
      if (inspection.status === "ready") {
        await expect(resolveBrowserRuntime()).resolves.toEqual(
          expect.objectContaining({
            executableSha256: inspection.runtime!.executableSha256,
          }),
        );
      }
    } else {
      expect(inspection.runtime).toBeUndefined();
    }
  });

  it("installs only the exact previewed runtime through an allowlisted environment", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-install-"));
    roots.push(root);
    const executable = path.join(root, "chrome");
    await writeFile(executable, "installed browser");
    await chmod(executable, 0o755);
    const runtime = await resolveBrowserRuntime(executable);
    const target = (await inspectPinnedBrowserRuntime()).target;
    let inspectionCount = 0;
    let installerRequest:
      | {
          command: string;
          args: string[];
          cwd: string;
          env: NodeJS.ProcessEnv;
        }
      | undefined;

    const installed = await installPinnedBrowserRuntime(
      {
        env: {
          HOME: root,
          PATH: process.env.PATH,
          HTTPS_PROXY: "https://proxy.invalid/",
          DEEPSEEK_API_KEY: "must-not-reach-installer",
          NAPIER_BROWSER_EXECUTABLE: "/must/not/reach/installer",
        },
        signal: new AbortController().signal,
      },
      {
        inspect: async () => {
          inspectionCount += 1;
          return inspectionCount === 1
            ? { target, status: "installable" }
            : { target, status: "ready", runtime };
        },
        runInstaller: async (request) => {
          installerRequest = request;
          return {
            exitCode: 0,
            outputBytes: 0,
            outputSha256: "b".repeat(64),
          };
        },
      },
    );

    expect(installed.runtime).toEqual(runtime);
    expect(installerRequest).toEqual(
      expect.objectContaining({
        command: process.execPath,
        args: [expect.stringMatching(/browser-runtime-installer-child\.js$/u)],
        cwd: expect.stringContaining("playwright-core"),
        env: expect.objectContaining({
          HOME: root,
          PATH: process.env.PATH,
          HTTPS_PROXY: "https://proxy.invalid/",
          PLAYWRIGHT_SKIP_BROWSER_GC: "1",
        }),
      }),
    );
    expect(installerRequest!.env).not.toHaveProperty("DEEPSEEK_API_KEY");
    expect(installerRequest!.env).not.toHaveProperty(
      "NAPIER_BROWSER_EXECUTABLE",
    );
  });

  it("bounds installer output and cancels the detached process group", async () => {
    const root = await mkdtemp(
      path.join(tmpdir(), "napier-browser-installer-"),
    );
    roots.push(root);
    const noisyScript = path.join(root, "noisy.mjs");
    await writeFile(
      noisyScript,
      "process.stdout.write('x'.repeat(70000)); setInterval(() => {}, 1000);",
    );

    await expect(
      runBrowserRuntimeInstaller({
        command: process.execPath,
        args: [noisyScript],
        cwd: root,
        env: { PATH: process.env.PATH },
        signal: AbortSignal.timeout(5_000),
      }),
    ).rejects.toThrow("exceeded its output limit");

    const waitingScript = path.join(root, "waiting.mjs");
    await writeFile(waitingScript, "setInterval(() => {}, 1000);");
    const controller = new AbortController();
    const operation = runBrowserRuntimeInstaller({
      command: process.execPath,
      args: [waitingScript],
      cwd: root,
      env: { PATH: process.env.PATH },
      signal: controller.signal,
    });
    setTimeout(() => controller.abort(), 25).unref();
    await expect(operation).rejects.toThrow("was cancelled");
  });

  it("admits a pinned runtime only after a valid marker and rejects drift", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-browser-marker-"));
    roots.push(root);
    const runtimeRoot = path.join(root, "chromium-1234");
    const executable = path.join(runtimeRoot, "chrome");
    await mkdir(runtimeRoot);
    await writeFile(executable, "verified browser");
    await chmod(executable, 0o755);
    const runtime = await resolveBrowserRuntime(executable);
    const target = {
      packageName: "playwright-core" as const,
      packageVersion: "1.62.1",
      browserName: "chromium" as const,
      browserRevision: "1234",
      browserVersion: "151.0.7922.34",
      platform: process.platform,
      arch: process.arch,
      runtimeLocationSha256: sha256(await realpath(executable)),
    };

    await expect(
      verifiedPinnedBrowserRuntimeCandidate(executable),
    ).resolves.toBeUndefined();
    await markPinnedBrowserRuntimeVerified({ target, runtime });
    await expect(
      verifiedPinnedBrowserRuntimeCandidate(executable),
    ).resolves.toBe(await realpath(executable));

    await writeFile(executable, "drifted browser");
    await expect(
      verifiedPinnedBrowserRuntimeCandidate(executable),
    ).resolves.toBeUndefined();
  });
});
