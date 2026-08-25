import {
  inspectPinnedBrowserRuntime,
  installPinnedBrowserRuntime,
  markPinnedBrowserRuntimeVerified,
  type PinnedBrowserRuntimeInspection,
} from "@napier/runtime/browser-runtime-setup";
import {
  canonicalJson,
  sha256,
} from "@napier/runtime/core";
import {
  RunBrowserSessionManager,
} from "@napier/runtime/browser";

import type { CliSetupOptions } from "./cli-setup-options.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo } from "./cli-runtime.js";
import type {
  BrowserRuntimeSetupDependencies,
  BrowserRuntimeVerification,
} from "./browser-runtime-setup-model.js";
import { canonicalWorkspace } from "./workspace-path.js";

interface BrowserRuntimeSetupPreview {
  kind: "napier.browser-runtime-setup-preview";
  schemaVersion: 1;
  component: "browser";
  status: PinnedBrowserRuntimeInspection["status"];
  packageName: "playwright-core";
  packageVersion: string;
  browserName: "chromium";
  browserRevision: string;
  browserVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  runtimeLocationSha256: string;
  installedExecutableSha256?: string;
  contentSha256: string;
}

interface BrowserRuntimeSetupResult {
  kind: "napier.browser-runtime-setup-result";
  schemaVersion: 1;
  component: "browser";
  action: "installed" | "reused";
  status: "ready";
  packageName: "playwright-core";
  packageVersion: string;
  browserName: "chromium";
  browserRevision: string;
  browserVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  runtimeLocationSha256: string;
  executableSha256: string;
  destinationCount: number;
  chromiumSandbox: true;
  contentSha256: string;
}

export async function executeBrowserRuntimeSetup(
  options: CliSetupOptions,
  io: CliIo,
  dependencies: BrowserRuntimeSetupDependencies = {},
  parentSignal?: AbortSignal,
): Promise<number> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs!);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
  try {
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    const inspect = dependencies.inspect ?? inspectPinnedBrowserRuntime;
    const inspection = await inspect();
    const preview = createBrowserRuntimeSetupPreview(inspection);
    if (!options.apply) {
      await writeBrowserRuntimeSetupOutput(preview, options.jsonl, io);
      return preview.status === "unsupported" ? 1 : 0;
    }
    if (options.expectedPreviewSha256 !== preview.contentSha256) {
      throw new Error("Browser setup preview is stale");
    }
    if (inspection.status === "unsupported") {
      throw new Error("Pinned Browser runtime is unsupported on this host");
    }
    const installed =
      (inspection.status === "ready" || inspection.status === "installed") &&
      inspection.runtime
        ? inspection
        : await installPinnedBrowserRuntime(
            { env: io.env, signal },
            {
              inspect,
              ...(dependencies.runInstaller
                ? { runInstaller: dependencies.runInstaller }
                : {}),
            },
          );
    const verification = await (dependencies.verify ?? verifyBrowserRuntime)(
      workspaceRoot,
      installed.runtime!,
      signal,
    );
    if (verification.executableSha256 !== installed.runtime!.executableSha256) {
      throw new Error("Pinned Browser runtime verification identity mismatch");
    }
    await (dependencies.markVerified ?? markPinnedBrowserRuntimeVerified)({
      target: installed.target,
      runtime: installed.runtime!,
    });
    await writeBrowserRuntimeSetupOutput(
      createBrowserRuntimeSetupResult(
        installed,
        inspection.status === "installable" ? "installed" : "reused",
        verification,
      ),
      options.jsonl,
      io,
    );
    return 0;
  } catch (error) {
    const diagnosticSha256 = sha256(
      error instanceof Error ? error.message : String(error),
    );
    await writeLine(
      io.stderr,
      `Napier Browser setup failed (${diagnosticSha256.slice(0, 16)})`,
    );
    return 1;
  }
}

function createBrowserRuntimeSetupPreview(
  inspection: PinnedBrowserRuntimeInspection,
): BrowserRuntimeSetupPreview {
  const target = inspection.target;
  const withoutHash = {
    kind: "napier.browser-runtime-setup-preview" as const,
    schemaVersion: 1 as const,
    component: "browser" as const,
    status: inspection.status,
    packageName: target.packageName,
    packageVersion: target.packageVersion,
    browserName: target.browserName,
    browserRevision: target.browserRevision,
    browserVersion: target.browserVersion,
    platform: target.platform,
    arch: target.arch,
    runtimeLocationSha256: target.runtimeLocationSha256,
    ...(inspection.runtime
      ? { installedExecutableSha256: inspection.runtime.executableSha256 }
      : {}),
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

function createBrowserRuntimeSetupResult(
  inspection: PinnedBrowserRuntimeInspection,
  action: BrowserRuntimeSetupResult["action"],
  verification: BrowserRuntimeVerification,
): BrowserRuntimeSetupResult {
  const target = inspection.target;
  const withoutHash = {
    kind: "napier.browser-runtime-setup-result" as const,
    schemaVersion: 1 as const,
    component: "browser" as const,
    action,
    status: "ready" as const,
    packageName: target.packageName,
    packageVersion: target.packageVersion,
    browserName: target.browserName,
    browserRevision: target.browserRevision,
    browserVersion: target.browserVersion,
    platform: target.platform,
    arch: target.arch,
    runtimeLocationSha256: target.runtimeLocationSha256,
    executableSha256: verification.executableSha256,
    destinationCount: verification.destinationCount,
    chromiumSandbox: verification.chromiumSandbox,
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

async function verifyBrowserRuntime(
  workspaceRoot: string,
  runtime: NonNullable<PinnedBrowserRuntimeInspection["runtime"]>,
  signal: AbortSignal,
): Promise<BrowserRuntimeVerification> {
  const manager = new RunBrowserSessionManager({
    workspaceRoot,
    resolveRuntime: async () => runtime,
  });
  const owner = {
    threadId: "thread_browser_setup",
    runId: "run_browser_setup",
  };
  try {
    const started = await manager.execute(
      owner,
      { action: "start", url: "https://example.com/" },
      signal,
    );
    await manager.execute(owner, { action: "close" }, signal);
    return {
      executableSha256: started.details.browserExecutableSha256!,
      destinationCount: started.details.network.destinationCount,
      chromiumSandbox: true,
    };
  } finally {
    await manager.cancelRun(owner);
  }
}

async function writeBrowserRuntimeSetupOutput(
  output: BrowserRuntimeSetupPreview | BrowserRuntimeSetupResult,
  jsonl: boolean,
  io: CliIo,
): Promise<void> {
  if (jsonl) {
    await writeJsonLine(io.stdout, output);
    return;
  }
  if (output.kind === "napier.browser-runtime-setup-preview") {
    await writeLine(
      io.stdout,
      [
        "Browser runtime setup",
        `Status: ${output.status}`,
        `Package: ${output.packageName}@${output.packageVersion}`,
        `Runtime: ${output.browserName} ${output.browserVersion} revision ${output.browserRevision}`,
        `Preview SHA-256: ${output.contentSha256}`,
        ...(output.status === "ready"
          ? ["Apply the exact preview to verify the installed runtime."]
          : output.status === "installable"
            ? [
                "Apply the exact preview to download and verify the pinned runtime.",
              ]
            : output.status === "installed"
              ? ["Apply the exact preview to verify the downloaded runtime."]
              : ["This pinned runtime is unsupported on the current host."]),
        ...(output.status === "unsupported"
          ? []
          : [
              `Apply: napier setup --workspace 'WORKSPACE_PATH' --component browser --expected-preview ${output.contentSha256} --apply`,
            ]),
      ].join("\n"),
    );
    return;
  }
  await writeLine(
    io.stdout,
    [
      `Browser runtime: ${output.action}`,
      `Package: ${output.packageName}@${output.packageVersion}`,
      `Runtime: ${output.browserName} ${output.browserVersion} revision ${output.browserRevision}`,
      "Status: ready",
    ].join("\n"),
  );
}
