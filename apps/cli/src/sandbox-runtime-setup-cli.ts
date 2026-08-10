import path from "node:path";

import {
  canonicalJson,
  OciContainerSandboxAdapter,
  sha256,
} from "@napier/runtime";
import { saveSandboxInstallation } from "@napier/runtime/sandbox-installation";
import {
  probeDapRuntime,
  probeGitRuntime,
  probeLocalServiceRuntime,
  probeLspRuntime,
  probePythonRuntime,
  probeSandboxProcessRuntime,
  probeShellRuntime,
} from "@napier/runtime/doctor-probes";
import {
  buildOfficialSandboxRuntime,
  inspectOfficialSandboxRuntime,
  type SandboxRuntimeInspection,
} from "@napier/runtime/sandbox-runtime-setup";

import type { CliSetupOptions } from "./cli-setup-options.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo } from "./cli-runtime.js";
import type {
  CliSandboxRuntimeSetupDependencies,
  SandboxInstallationIdentity,
  SandboxRuntimeVerification,
} from "./sandbox-runtime-setup-model.js";
import { canonicalWorkspace } from "./workspace-path.js";

interface SandboxRuntimeSetupPreview {
  kind: "napier.sandbox-runtime-setup-preview";
  schemaVersion: 1;
  component: "sandbox";
  status: SandboxRuntimeInspection["status"];
  imageReference: string;
  imageId?: string;
  dockerfileSha256: string;
  contextSha256: string;
  platform: NodeJS.Platform;
  arch: string;
  contentSha256: string;
}

interface SandboxRuntimeSetupResult {
  kind: "napier.sandbox-runtime-setup-result";
  schemaVersion: 1;
  component: "sandbox";
  action: "built" | "reused";
  status: "ready";
  imageReference: string;
  imageId: string;
  dockerfileSha256: string;
  contextSha256: string;
  identitySha256: string;
  installationSha256: string;
  checks: SandboxRuntimeVerification["checks"];
  contentSha256: string;
}

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
    const inspect = dependencies.inspect ?? inspectOfficialSandboxRuntime;
    const inspection = await inspect();
    const preview = createSandboxRuntimeSetupPreview(inspection);
    if (!options.apply) {
      await writeSandboxRuntimeSetupOutput(preview, options.jsonl, io);
      return ["unsupported", "runtime_unavailable"].includes(preview.status)
        ? 1
        : 0;
    }
    if (options.expectedPreviewSha256 !== preview.contentSha256) {
      throw new Error("Sandbox setup preview is stale");
    }
    if (
      inspection.status === "unsupported" ||
      inspection.status === "runtime_unavailable"
    ) {
      throw new Error("Official Sandbox runtime is unavailable on this host");
    }
    const ready =
      inspection.status === "ready" && inspection.identity
        ? {
            ...inspection,
            status: "ready" as const,
            identity: inspection.identity,
          }
        : await buildOfficialSandboxRuntime(
            { signal },
            {
              inspect,
              ...(dependencies.runBuild
                ? { runBuild: dependencies.runBuild }
                : {}),
            },
          );
    const verification = await (dependencies.verify ?? verifySandboxRuntime)({
      workspaceRoot,
      dataRoot,
      imageReference: ready.target.imageReference,
      identity: ready.identity,
      signal,
    });
    const result = createSandboxRuntimeSetupResult(
      ready,
      inspection.status === "ready" ? "reused" : "built",
      verification,
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

function createSandboxRuntimeSetupPreview(
  inspection: SandboxRuntimeInspection,
): SandboxRuntimeSetupPreview {
  const withoutHash = {
    kind: "napier.sandbox-runtime-setup-preview" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    status: inspection.status,
    imageReference: inspection.target.imageReference,
    ...(inspection.identity ? { imageId: inspection.identity.imageId } : {}),
    dockerfileSha256: inspection.target.dockerfileSha256,
    contextSha256: inspection.target.contextSha256,
    platform: inspection.target.platform,
    arch: inspection.target.arch,
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

function createSandboxRuntimeSetupResult(
  inspection: SandboxRuntimeInspection & {
    status: "ready";
    identity: SandboxInstallationIdentity;
  },
  action: SandboxRuntimeSetupResult["action"],
  verification: SandboxRuntimeVerification,
): SandboxRuntimeSetupResult {
  const withoutHash = {
    kind: "napier.sandbox-runtime-setup-result" as const,
    schemaVersion: 1 as const,
    component: "sandbox" as const,
    action,
    status: "ready" as const,
    imageReference: inspection.target.imageReference,
    imageId: inspection.identity.imageId,
    dockerfileSha256: inspection.target.dockerfileSha256,
    contextSha256: inspection.target.contextSha256,
    identitySha256: inspection.identity.identitySha256,
    installationSha256: verification.installation.contentSha256,
    checks: verification.checks,
  };
  return {
    ...withoutHash,
    contentSha256: sha256(canonicalJson(withoutHash)),
  };
}

async function verifySandboxRuntime(input: {
  workspaceRoot: string;
  dataRoot: string;
  imageReference: string;
  identity: SandboxInstallationIdentity;
  signal: AbortSignal;
}): Promise<SandboxRuntimeVerification> {
  const sandbox = new OciContainerSandboxAdapter(input.identity.imageId);
  const probes = {
    node: await probeSandboxProcessRuntime(
      input.workspaceRoot,
      input.signal,
      sandbox,
    ),
    shell: await probeShellRuntime(input.workspaceRoot, input.signal, sandbox),
    python: await probePythonRuntime(
      input.workspaceRoot,
      input.signal,
      sandbox,
    ),
    git: await probeGitRuntime(input.workspaceRoot, input.signal, sandbox),
    lsp: await probeLspRuntime(input.workspaceRoot, input.signal, sandbox),
    dap: await probeDapRuntime(input.workspaceRoot, input.signal, sandbox),
    service: await probeLocalServiceRuntime(
      input.workspaceRoot,
      input.signal,
      sandbox,
    ),
  };
  for (const [name, probe] of Object.entries(probes)) {
    if (probe.status !== "ready") {
      throw new Error(`Official Sandbox ${name} verification failed`);
    }
  }
  const installation = await saveSandboxInstallation(
    input.dataRoot,
    input.imageReference,
    input.identity,
  );
  return {
    checks: Object.fromEntries(
      Object.entries(probes).map(([name, probe]) => [name, probe.code]),
    ) as SandboxRuntimeVerification["checks"],
    installation,
  };
}

async function writeSandboxRuntimeSetupOutput(
  output: SandboxRuntimeSetupPreview | SandboxRuntimeSetupResult,
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
