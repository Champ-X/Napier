import path from "node:path";

import { sha256 } from "@napier/runtime";
import {
  createConfiguredSandboxAdapter,
  createSandboxFallbackAdapter,
} from "@napier/runtime/sandbox-installation";
import { SandboxSetupService } from "@napier/runtime/sandbox-setup-service";
import { SwitchableSandboxAdapter } from "@napier/runtime/sandbox-switchable";

import type { CliSetupOptions } from "./cli-setup-options.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo } from "./cli-runtime.js";
import type { CliSandboxRuntimeSetupDependencies } from "./sandbox-runtime-setup-model.js";
import { canonicalWorkspace } from "./workspace-path.js";
import type {
  SandboxSetupPreview,
  SandboxSetupResult,
  SandboxUninstallPreview,
  SandboxUninstallResult,
} from "@napier/contracts/sandbox-setup";

export async function executeSandboxRuntimeSetup(
  options: CliSetupOptions,
  io: CliIo,
  dependencies: CliSandboxRuntimeSetupDependencies = {},
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
    const fallback = createSandboxFallbackAdapter({ env: io.env });
    const current = options.uninstall
      ? ((await createConfiguredSandboxAdapter({
          dataRoot,
          env: io.env,
        }).catch(() => fallback)) ?? fallback)
      : ((await createConfiguredSandboxAdapter({
          dataRoot,
          env: io.env,
        })) ?? fallback);
    const setup = new SandboxSetupService(
      workspaceRoot,
      dataRoot,
      new SwitchableSandboxAdapter(current),
      {
        ...dependencies,
        fallback: dependencies.fallback ?? (() => fallback),
      },
    );
    const preview = options.uninstall
      ? await setup.uninstallPreview()
      : await setup.preview();
    if (!options.apply) {
      await writeSandboxRuntimeSetupOutput(preview, options.jsonl, io);
      return preview.kind === "napier.sandbox-runtime-setup-preview" &&
        ["unsupported", "runtime_unavailable"].includes(preview.status)
        ? 1
        : 0;
    }
    const result = options.uninstall
      ? await setup.uninstall({
          expectedPreviewSha256: options.expectedPreviewSha256!,
        })
      : await setup.apply(
          { expectedPreviewSha256: options.expectedPreviewSha256! },
          signal,
        );
    await writeSandboxRuntimeSetupOutput(result, options.jsonl, io);
    return 0;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const diagnosticSha256 = sha256(message);
    const recovery = sandboxSetupRecovery(message);
    await writeLine(
      io.stderr,
      `Napier Sandbox setup failed (${diagnosticSha256.slice(0, 16)})${recovery ? `. ${recovery}` : ""}`,
    );
    return 1;
  }
}

function sandboxSetupRecovery(message: string): string | undefined {
  if (message === "Official Sandbox node verification failed") {
    return "Container launch verification failed. Ensure the workspace path is shared with the local Docker daemon, then rerun the preview and exact apply";
  }
  return undefined;
}

async function writeSandboxRuntimeSetupOutput(
  output:
    | SandboxSetupPreview
    | SandboxSetupResult
    | SandboxUninstallPreview
    | SandboxUninstallResult,
  jsonl: boolean,
  io: CliIo,
): Promise<void> {
  if (jsonl) {
    await writeJsonLine(io.stdout, output);
    return;
  }
  if (output.kind === "napier.sandbox-runtime-setup-preview") {
    await writeLine(
      io.stdout,
      [
        "Sandbox runtime setup",
        `Status: ${output.status}`,
        `Acquisition: ${output.acquisition}`,
        `Image: ${output.imageReference}`,
        ...(output.releaseDigest
          ? [`Release digest: ${output.releaseDigest}`]
          : []),
        `Dockerfile SHA-256: ${output.dockerfileSha256}`,
        `Preview SHA-256: ${output.contentSha256}`,
        ...(output.status === "runtime_unavailable"
          ? [
              "Start a local Docker daemon, then rerun this preview. Remote daemon endpoints are rejected.",
            ]
          : output.status === "unsupported"
            ? ["This host platform is not supported by the OCI Sandbox setup."]
            : [
                output.status === "ready"
                  ? "Apply the exact preview to verify and persist this image; if its pinned toolchain has drifted, Setup rebuilds it once from the packaged source and verifies again."
                  : output.status === "pullable"
                    ? "Apply the exact preview to anonymously pull the reviewed immutable release and verify it. If the public registry is unavailable, Setup builds the same pinned source locally."
                    : "Apply the exact preview to build, verify, and persist this image.",
                `Apply: napier setup --workspace 'WORKSPACE_PATH' --component sandbox --expected-preview ${output.contentSha256} --apply`,
              ]),
      ].join("\n"),
    );
    return;
  }
  if (output.kind === "napier.sandbox-runtime-uninstall-preview") {
    await writeLine(
      io.stdout,
      [
        "Sandbox runtime uninstall",
        `Status: ${output.status}`,
        `Fallback: ${output.fallbackSandbox}`,
        "Image: retained in the local OCI cache",
        ...(output.status !== "not_installed" && output.bindingSha256
          ? [
              `Preview SHA-256: ${output.contentSha256}`,
              `Apply: napier setup --workspace 'WORKSPACE_PATH' --component sandbox --uninstall --expected-preview ${output.contentSha256} --apply`,
            ]
          : [
              output.status === "not_installed"
                ? "No Napier Sandbox installation binding is configured."
                : "The binding is not a bounded regular file and cannot be safely removed automatically.",
            ]),
      ].join("\n"),
    );
    return;
  }
  if (output.kind === "napier.sandbox-runtime-uninstall-result") {
    await writeLine(
      io.stdout,
      [
        "Sandbox runtime: uninstalled",
        `Fallback: ${output.fallbackSandbox}`,
        ...(output.imageId
          ? [`Image ID retained: ${output.imageId}`]
          : [
              "Persisted invalid binding removed; no image identity was trusted.",
            ]),
        "Status: removed",
      ].join("\n"),
    );
    return;
  }
  await writeLine(
    io.stdout,
    [
      `Sandbox runtime: ${
        output.action === "repaired"
          ? "repaired from pinned source"
          : output.action === "pulled"
            ? "pulled immutable release"
            : output.action
      }`,
      `Acquisition: ${output.acquisition}`,
      `Image: ${output.imageReference}`,
      ...(output.releaseDigest
        ? [`Release digest: ${output.releaseDigest}`]
        : []),
      `Image ID: ${output.imageId}`,
      "Verified: Node, Shell, Python, Git, LSP, DAP, TypeScript/Vitest/Prettier verification, local service, and runtime resource boundaries",
      "Status: ready",
    ].join("\n"),
  );
}
