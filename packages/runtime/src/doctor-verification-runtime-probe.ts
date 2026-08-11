import { createPlatformSandboxAdapter } from "./sandbox.js";
import type { OsSandboxAdapter } from "./sandbox-types.js";
import { runSandboxedProcess } from "./sandboxed-process.js";
import {
  assertVerificationRuntimeStable,
  resolveVerificationRuntime,
} from "./verification-runtime.js";
import type { VerificationKind } from "./verification-types.js";

const PROBE_TIMEOUT_MS = 5_000;
const MAX_PROBE_OUTPUT_CHARS = 256;
const KINDS = ["typecheck", "test", "format"] as const;

export async function probeVerificationRuntime(
  workspaceRoot: string,
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
) {
  try {
    const evidence: Record<string, string> = {};
    for (const kind of KINDS) {
      const runtime = await resolveVerificationRuntime({
        workspaceRoot,
        sandbox,
        kind,
        nodeExecutable: process.execPath,
        nodeExecutableExplicit: false,
      });
      if (
        runtime.location !== "provider" ||
        !runtime.verifierVersion ||
        !runtime.runtimeIdentitySha256
      ) {
        throw new Error("Verification runtime is not provider-bound");
      }
      const result = await runSandboxedProcess({
        sandbox,
        launch: {
          command: runtime.nodeExecutable,
          args: [runtime.verifierPath, "--version"],
          cwd: workspaceRoot,
          env: { CI: "1", FORCE_COLOR: "0", NO_COLOR: "1" },
          workspaceRoot,
          approvedCapabilities: ["process.spawn", "workspace.read"],
        },
        timeoutMs: PROBE_TIMEOUT_MS,
        maxOutputChars: MAX_PROBE_OUTPUT_CHARS,
        ...(signal ? { signal } : {}),
        abortedMessage: "Verification runtime probe was cancelled",
      });
      if (
        result.status !== "exited" ||
        result.exitCode !== 0 ||
        result.stderr !== "" ||
        !versionOutput(kind, runtime.verifierVersion, result.stdout)
      ) {
        throw new Error("Verification runtime returned an invalid version");
      }
      await assertVerificationRuntimeStable(runtime, sandbox);
      evidence[`${kind}Version`] = runtime.verifierVersion;
      evidence[`${kind}Sha256`] = runtime.verifierSha256;
      evidence[`${kind}RuntimeIdentitySha256`] = runtime.runtimeIdentitySha256;
    }
    return {
      status: "ready" as const,
      code: "verification_ready",
      message: `The active ${sandbox.id} provider executed the identity-bound TypeScript, Vitest, and Prettier verifier CLIs`,
      evidence: {
        adapter: sandbox.id,
        productionCall: true,
        verifierCount: KINDS.length,
        ...evidence,
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    return {
      status: "unavailable" as const,
      code: "verification_provider_unavailable",
      message:
        "The active provider could not execute the identity-bound TypeScript, Vitest, and Prettier verifier CLIs; build and test claims fail closed",
    };
  }
}

function versionOutput(
  kind: VerificationKind,
  version: string,
  output: string,
): boolean {
  const value = output.trim();
  if (kind === "typecheck") return value === `Version ${version}`;
  if (kind === "format") return value === version;
  return value.startsWith(`vitest/${version} `);
}
