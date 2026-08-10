import { realpath } from "node:fs/promises";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  assertLspRuntimeStable,
  lspProviderRuntimeLimitEvidence,
  resolveLspRuntimeAssets,
} from "./lsp-runtime-assets.js";
import { resolveLspRuntimeReadPaths } from "./lsp-runtime-read-paths.js";
import { LSP_FIXED_ENVIRONMENT } from "./lsp-source-session.js";
import {
  createPlatformSandboxAdapter,
  type OsSandboxAdapter,
} from "./sandbox.js";
import { runSandboxedProcess } from "./sandboxed-process.js";

const LSP_PROBE_TIMEOUT_MS = 5_000;
const LSP_PROBE_MAX_OUTPUT_CHARS = 1_024;

interface LspRuntimeCapabilityProbe {
  status: "ready" | "available_unverified" | "unavailable";
  code: string;
  message: string;
  evidence?: Record<string, boolean | number | string>;
}

/** Executes the image- or host-bound language server through the production Sandbox. */
export async function probeLspRuntime(
  workspaceRoot = process.cwd(),
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
): Promise<LspRuntimeCapabilityProbe> {
  try {
    const canonicalWorkspace = await realpath(workspaceRoot);
    const assets = await resolveLspRuntimeAssets({
      sandbox,
    });
    const runtimeReadPaths = assets.runtimeIdentitySha256
      ? []
      : await resolveLspRuntimeReadPaths(
          [assets.languageServerRoot, assets.typescriptRoot],
          undefined,
        );
    const result = await runSandboxedProcess({
      sandbox,
      launch: {
        command: assets.nodeExecutable,
        args: [assets.languageServerPath, "--version"],
        cwd: canonicalWorkspace,
        env: { ...LSP_FIXED_ENVIRONMENT },
        workspaceRoot: canonicalWorkspace,
        approvedCapabilities: ["process.spawn", "workspace.read"],
        ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
      },
      timeoutMs: LSP_PROBE_TIMEOUT_MS,
      maxOutputChars: LSP_PROBE_MAX_OUTPUT_CHARS,
      ...(signal ? { signal } : {}),
      abortedMessage: "LSP production probe was aborted",
    });
    if (
      result.status !== "exited" ||
      result.exitCode !== 0 ||
      result.stderr !== "" ||
      result.stdout.trim() !== assets.languageServerVersion
    ) {
      throw new Error("LSP production probe returned an invalid result");
    }
    await assertLspRuntimeStable(assets, "LSP production probe", sandbox);
    return {
      status: "ready",
      code: "lsp_ready",
      message: `The active ${sandbox.id} provider completed a bounded TypeScript language-server command through the production execution path`,
      evidence: {
        adapter: sandbox.id,
        productionCall: true,
        nodeExecutableSha256: assets.nodeExecutableSha256,
        languageServerVersion: assets.languageServerVersion,
        languageServerSha256: assets.languageServerSha256,
        typescriptVersion: assets.typescriptVersion,
        typescriptServerSha256: assets.typescriptServerSha256,
        ...lspProviderRuntimeLimitEvidence(assets),
        resourceLimitsSha256: sha256(
          canonicalJson({
            ...lspProviderRuntimeLimitEvidence(assets),
            timeoutMs: LSP_PROBE_TIMEOUT_MS,
            maxOutputChars: LSP_PROBE_MAX_OUTPUT_CHARS,
            environment: LSP_FIXED_ENVIRONMENT,
            expectedVersion: assets.languageServerVersion,
            processGroupTermination: true,
          }),
        ),
        exitCode: result.exitCode,
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      /image-bound LSP runtime is unavailable|Cannot find (?:module|package)|package metadata is unavailable/iu.test(
        message,
      );
    return {
      status: "unavailable",
      code: missing ? "lsp_missing" : "lsp_provider_unavailable",
      message: missing
        ? "The active provider has no identity-bound TypeScript language server and tsserver; LSP tasks fail closed"
        : "The active provider could not complete the production TypeScript language-server probe; LSP tasks fail closed",
    };
  }
}
