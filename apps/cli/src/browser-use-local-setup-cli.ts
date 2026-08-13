import path from "node:path";

import {
  canonicalJson,
  installBrowserUseLocalRuntime,
  inspectBrowserUseLocalRuntime,
  sha256,
  type BrowserUseLocalInspection,
} from "@napier/runtime";

import type { CliSetupOptions } from "./cli-setup-options.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo } from "./cli-runtime.js";
import type { BrowserUseLocalSetupDependencies } from "@napier/runtime";
import { canonicalWorkspace } from "./workspace-path.js";

interface BrowserUseLocalSetupPreview {
  kind: "napier.browser-use-local-setup-preview";
  schemaVersion: 1;
  component: "browser-use-local";
  backend: "browser_use_local";
  status: BrowserUseLocalInspection["status"];
  packageName: "browser-use";
  packageVersion: string;
  pythonVersion: "3.12";
  browserProduct?: "system_chrome" | "system_chromium";
  browserVersion?: string;
  platform: NodeJS.Platform;
  arch: string;
  contentSha256: string;
}

interface BrowserUseLocalSetupResult {
  kind: "napier.browser-use-local-setup-result";
  schemaVersion: 1;
  component: "browser-use-local";
  backend: "browser_use_local";
  action: "installed" | "reused";
  status: "ready";
  packageName: "browser-use";
  packageVersion: string;
  pythonVersion: "3.12";
  browserProduct: "system_chrome" | "system_chromium";
  browserVersion: string;
  platform: NodeJS.Platform;
  arch: string;
  telemetry: "disabled";
  cloudSync: "disabled";
  workspaceAccess: "none";
  contentSha256: string;
}

export async function executeBrowserUseLocalSetup(
  options: CliSetupOptions,
  io: CliIo,
  dependencies: BrowserUseLocalSetupDependencies = {},
  parentSignal?: AbortSignal,
): Promise<number> {
  const timeoutSignal = AbortSignal.timeout(options.timeoutMs!);
  const signal = parentSignal
    ? AbortSignal.any([parentSignal, timeoutSignal])
    : timeoutSignal;
  try {
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    const dataRoot = path.resolve(
      io.cwd,
      options.dataRoot ?? path.join(workspaceRoot, ".napier"),
    );
    const inspection = await inspectBrowserUseLocalRuntime(
      dataRoot,
      dependencies,
    );
    const preview = createPreview(inspection);
    if (!options.apply) {
      await writeOutput(preview, options, io);
      return preview.status === "unsupported" ? 1 : 0;
    }
    if (options.expectedPreviewSha256 !== preview.contentSha256) {
      throw new Error("Browser Use local setup preview is stale");
    }
    if (inspection.status === "unsupported") {
      throw new Error(
        "Browser Use local requires uv and a supported macOS, Linux, or Windows host",
      );
    }
    const ready =
      inspection.status === "ready"
        ? { ...inspection, status: "ready" as const }
        : await installBrowserUseLocalRuntime(
            { dataRoot, env: io.env, signal },
            dependencies,
          );
    await writeOutput(
      createResult(
        ready,
        inspection.status === "ready" ? "reused" : "installed",
      ),
      options,
      io,
    );
    return 0;
  } catch (error) {
    const diagnostic = sha256(
      error instanceof Error ? error.message : String(error),
    ).slice(0, 16);
    await writeLine(
      io.stderr,
      `Napier Browser Use local setup failed (${diagnostic}). Rerun the preview, then exact-apply its SHA-256.`,
    );
    return 1;
  }
}

function createPreview(
  inspection: BrowserUseLocalInspection,
): BrowserUseLocalSetupPreview {
  const content = {
    kind: "napier.browser-use-local-setup-preview" as const,
    schemaVersion: 1 as const,
    component: "browser-use-local" as const,
    backend: inspection.backend,
    status: inspection.status,
    packageName: inspection.packageName,
    packageVersion: inspection.packageVersion,
    pythonVersion: inspection.pythonVersion,
    ...(inspection.browserProduct
      ? { browserProduct: inspection.browserProduct }
      : {}),
    ...(inspection.browserVersion
      ? { browserVersion: inspection.browserVersion }
      : {}),
    platform: inspection.platform,
    arch: inspection.arch,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

function createResult(
  inspection: BrowserUseLocalInspection & { status: "ready" },
  action: "installed" | "reused",
): BrowserUseLocalSetupResult {
  const content = {
    kind: "napier.browser-use-local-setup-result" as const,
    schemaVersion: 1 as const,
    component: "browser-use-local" as const,
    backend: inspection.backend,
    action,
    status: "ready" as const,
    packageName: inspection.packageName,
    packageVersion: inspection.packageVersion,
    pythonVersion: inspection.pythonVersion,
    browserProduct: inspection.browserProduct!,
    browserVersion: inspection.browserVersion!,
    platform: inspection.platform,
    arch: inspection.arch,
    telemetry: "disabled" as const,
    cloudSync: "disabled" as const,
    workspaceAccess: "none" as const,
  };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

async function writeOutput(
  output: BrowserUseLocalSetupPreview | BrowserUseLocalSetupResult,
  options: CliSetupOptions,
  io: CliIo,
): Promise<void> {
  if (options.jsonl) {
    await writeJsonLine(io.stdout, output);
    return;
  }
  if (output.kind === "napier.browser-use-local-setup-preview") {
    await writeLine(
      io.stdout,
      [
        "Browser Use local setup",
        `Backend: ${output.backend}`,
        `Package: ${output.packageName} ${output.packageVersion}`,
        `Status: ${output.status}`,
        "Data flow: local Browser; page/model traffic still reaches the selected public services",
        "Workspace access: none",
        ...(output.status === "unsupported"
          ? [
              "Recovery: install uv and current Chrome on a supported host, then rerun this preview",
            ]
          : [
              `Apply: napier setup --workspace '${options.workspace}' --component browser-use-local --expected-preview ${output.contentSha256} --apply`,
            ]),
      ].join("\n"),
    );
    return;
  }
  await writeLine(
    io.stdout,
    [
      `Browser Use local: ${output.status}`,
      `Package: ${output.packageName} ${output.packageVersion}`,
      `Browser: ${output.browserProduct.replace("system_", "")} ${output.browserVersion}`,
      `Action: ${output.action}`,
      "Telemetry: disabled",
      "Cloud sync: disabled",
      "Next: napier doctor --workspace 'WORKSPACE_PATH' --browser-backend browser_use_local --offline",
    ].join("\n"),
  );
}
