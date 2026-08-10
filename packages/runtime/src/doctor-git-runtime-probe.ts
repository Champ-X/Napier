import { runGitInspectProcess } from "./git-inspect-process.js";
import {
  createPlatformSandboxAdapter,
  type OsSandboxAdapter,
} from "./sandbox.js";

const GIT_PROBE_TIMEOUT_MS = 5_000;

interface GitRuntimeCapabilityProbe {
  status: "ready" | "available_unverified" | "unavailable";
  code: string;
  message: string;
  evidence?: Record<string, boolean | number | string>;
}

/** Executes the same fixed-environment Git process boundary used by Git tools. */
export async function probeGitRuntime(
  workspaceRoot: string,
  signal?: AbortSignal,
  sandbox: OsSandboxAdapter = createPlatformSandboxAdapter(),
): Promise<GitRuntimeCapabilityProbe> {
  try {
    const result = await runGitInspectProcess(
      { workspaceRoot, sandbox },
      ["--version"],
      GIT_PROBE_TIMEOUT_MS,
      signal,
    );
    if (
      result.status !== "succeeded" ||
      result.stderr !== "" ||
      !/^git version [^\u0000-\u001f\u007f]{1,160}\n?$/u.test(result.stdout)
    ) {
      throw new Error("Git production probe returned an invalid result");
    }
    return {
      status: "ready",
      code: "git_ready",
      message: `The active ${sandbox.id} provider completed a bounded Git command through the production execution path`,
      evidence: {
        adapter: sandbox.id,
        productionCall: true,
        executableSha256: result.executableSha256,
        ...(result.runtimeIdentitySha256
          ? { runtimeIdentitySha256: result.runtimeIdentitySha256 }
          : {}),
        resourceLimitsSha256: result.resourceLimitsSha256,
        exitCode: result.exitCode!,
      },
    };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : String(error);
    const missing =
      /Git runtime is unavailable|image-bound git runtime is unavailable/iu.test(
        message,
      );
    return {
      status: "unavailable",
      code: missing ? "git_missing" : "git_provider_unavailable",
      message: missing
        ? "The active provider has no identity-bound Git executable; Git tasks fail closed"
        : "The active provider could not complete the production Git command probe; Git tasks fail closed",
    };
  }
}
