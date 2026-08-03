import {
  gitConfigKeysPermitInspection,
  gitConfigKeysPermitStage,
  gitConfigPolicyArguments,
} from "./git-inspect-arguments.js";
import {
  runGitInspectProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import type { GitRepository } from "./git-repository.js";

export async function assertGitConfigPolicy(
  options: GitInspectProcessOptions,
  repository: GitRepository,
  timeoutMs: number,
  signal?: AbortSignal,
  operation:
    | "inspection"
    | "stage"
    | "commit"
    | "branch"
    | "switch" = "inspection",
): Promise<GitInspectProcessResult> {
  const result = await runGitInspectProcess(
    options,
    gitConfigPolicyArguments(repository),
    timeoutMs,
    signal,
  );
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    !(operation !== "inspection"
      ? gitConfigKeysPermitStage(result.stdout)
      : gitConfigKeysPermitInspection(result.stdout))
  ) {
    throw new Error("Git repository has unsafe execution configuration");
  }
  return result;
}
