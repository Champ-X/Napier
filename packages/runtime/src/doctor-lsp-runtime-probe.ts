import { realpath } from "node:fs/promises";
import path from "node:path";

import { canonicalJson, sha256 } from "./ed25519.js";
import { runLspProtocolSession } from "./lsp-protocol-session.js";
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

const LSP_PROBE_TIMEOUT_MS = 5_000;
const LSP_PROBE_SOURCE = "export const napierDoctorReady: string = 'ready';\n";

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
    const child = await sandbox.launch({
      command: assets.nodeExecutable,
      args: [assets.languageServerPath, "--stdio", "--log-level", "1"],
      cwd: canonicalWorkspace,
      env: { ...LSP_FIXED_ENVIRONMENT },
      workspaceRoot: canonicalWorkspace,
      approvedCapabilities: ["process.spawn", "workspace.read"],
      stdinMode: "open",
      ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
    });
    const result = await runLspProtocolSession(
      child,
      {
        label: "LSP Doctor probe",
        abortedMessage: "LSP production probe was aborted",
        workspaceRoot: canonicalWorkspace,
        target: path.join(canonicalWorkspace, ".napier-doctor-probe.ts"),
        language: "typescript",
        source: LSP_PROBE_SOURCE,
        timeoutMs: LSP_PROBE_TIMEOUT_MS,
        typescriptServerPath: assets.typescriptServerPath,
      },
      (connection, targetUri) => async () =>
        connection.sendRequest("textDocument/documentSymbol", {
          textDocument: { uri: targetUri },
        }),
      signal,
    );
    if (result.protocolBytes <= 0 || result.stderrTruncated) {
      throw new Error("LSP production probe returned an invalid result");
    }
    await assertLspRuntimeStable(assets, "LSP production probe", sandbox);
    return {
      status: "ready",
      code: "lsp_ready",
      message: `The active ${sandbox.id} provider completed a bounded TypeScript language-server stdio handshake through the production execution path`,
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
            environment: LSP_FIXED_ENVIRONMENT,
            protocol: "initialize_document_symbol_shutdown",
            virtualDocumentBytes: Buffer.byteLength(LSP_PROBE_SOURCE),
            processGroupTermination: true,
          }),
        ),
        stdioHandshake: true,
        protocolBytes: result.protocolBytes,
        stderrChars: result.stderr.length,
        stderrSha256: sha256(result.stderr),
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
