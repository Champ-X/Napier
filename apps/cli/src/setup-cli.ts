import path from "node:path";

import type {
  ProviderSetupPreview,
  ProviderSetupResult,
} from "@napier/contracts/provider-setup";

import type { CliSetupOptions } from "./cli-setup-options.js";
import { writeJsonLine, writeLine } from "./cli-output.js";
import type { CliIo, RunCliDependencies } from "./cli-runtime.js";
import { canonicalWorkspace } from "./workspace-path.js";

export async function executeSetup(
  options: CliSetupOptions,
  io: CliIo,
  dependencies: RunCliDependencies,
  signal?: AbortSignal,
): Promise<number> {
  let services;
  try {
    signal?.throwIfAborted();
    const workspaceRoot = await canonicalWorkspace(options.workspace, io.cwd);
    services = await dependencies.createRuntime({
      workspaceRoot,
      dataRoot: path.resolve(
        io.cwd,
        options.dataRoot ?? path.join(workspaceRoot, ".napier"),
      ),
      env: io.env,
    });
    signal?.throwIfAborted();
    if (options.component) {
      throw new Error("Provider setup does not accept a component");
    }
    const output = options.apply
      ? await services.providerSetup.apply({
          providerId: options.providerId!,
          expectedPreviewSha256: options.expectedPreviewSha256!,
        })
      : await services.providerSetup.preview();
    if (options.jsonl) {
      await writeJsonLine(io.stdout, output);
    } else if (output.kind === "napier.provider-setup-preview") {
      await writeLine(io.stdout, formatPreview(output, options));
    } else {
      await writeLine(io.stdout, formatResult(output));
    }
    return 0;
  } catch (error) {
    await writeLine(
      io.stderr,
      `Napier setup failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return 1;
  } finally {
    await services?.shutdown().catch(() => undefined);
  }
}

function formatPreview(
  preview: ProviderSetupPreview,
  options: CliSetupOptions,
): string {
  return [
    "Live Provider setup",
    ...preview.candidates.map(
      (candidate) =>
        `${candidate.providerId}: ${candidate.status} · ${candidate.model.provider}/${candidate.model.id} · ${candidate.environmentVariable}`,
    ),
    ...(preview.recommendedProviderId
      ? [
          "",
          `Recommended: ${preview.recommendedProviderId}`,
          `Apply: napier setup --workspace ${options.workspace} --provider ${preview.recommendedProviderId} --expected-preview ${preview.contentSha256} --apply`,
        ]
      : [
          "",
          "No standard Provider environment variable is currently available.",
        ]),
  ].join("\n");
}

function formatResult(result: ProviderSetupResult): string {
  return [
    `Provider: ${result.providerId}`,
    `Model: ${result.model.provider}/${result.model.id}`,
    `Action: ${result.action}`,
    "Status: ready",
  ].join("\n");
}
