import path from "node:path";

import { createPlatformSandboxAdapter, sha256 } from "@napier/runtime";
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
    const setup = new SandboxSetupService(
      workspaceRoot,
      dataRoot,
      new SwitchableSandboxAdapter(createPlatformSandboxAdapter()),
      dependencies,
    );
    const preview = await setup.preview();
    if (!options.apply) {
      await writeSandboxRuntimeSetupOutput(preview, options.jsonl, io);
      return ["unsupported", "runtime_unavailable"].includes(preview.status)
        ? 1
        : 0;
    }
    const result = await setup.apply(
      { expectedPreviewSha256: options.expectedPreviewSha256! },
      signal,
    );
    await writeSandboxRuntimeSetupOutput(result, options.jsonl, io);
    return 0;
  } catch (error) {
    const diagnosticSha256 = sha256(
      error instanceof Error ? error.message : String(error),
    );
    await writeLine(
      io.stderr,
      `Napier Sandbox setup failed (${diagnosticSha256.slice(0, 16)})`,
    );
    return 1;
  }
}

async function writeSandboxRuntimeSetupOutput(
  output: SandboxSetupPreview | SandboxSetupResult,
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
        `Image: ${output.imageReference}`,
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
                  ? "Apply the exact preview to verify and persist this image."
                  : "Apply the exact preview to build, verify, and persist this image.",
                `Apply: napier setup --workspace 'WORKSPACE_PATH' --component sandbox --expected-preview ${output.contentSha256} --apply`,
              ]),
      ].join("\n"),
    );
    return;
  }
  await writeLine(
    io.stdout,
    [
      `Sandbox runtime: ${output.action}`,
      `Image: ${output.imageReference}`,
      `Image ID: ${output.imageId}`,
      "Toolchain: Node, Shell, Python, Git, LSP, DAP, local service",
      "Status: ready",
    ].join("\n"),
  );
}
