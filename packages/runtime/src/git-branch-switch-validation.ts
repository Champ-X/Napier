import { canonicalJson, sha256 } from "./ed25519.js";
import { assertGitConfigPolicy } from "./git-config-policy.js";
import {
  gitHeadCommitArguments,
  gitRefCommitArguments,
} from "./git-inspect-arguments.js";
import {
  runGitInspectProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import {
  snapshotGitRepository,
  type GitBoundFile,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import { snapshotGitHeadReflog } from "./git-ref-files.js";
import type { GitBranchSwitchProcessEvidence } from "./git-branch-switch-model.js";

export interface PreparedGitBranchSwitch {
  evidence: GitBranchSwitchProcessEvidence;
  processes: GitInspectProcessResult[];
}

export async function prepareGitBranchSwitch(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  targetRef: string;
  expectedCommitSha1?: string;
  deadline: number;
  signal?: AbortSignal;
}): Promise<PreparedGitBranchSwitch> {
  const config = await assertGitConfigPolicy(
    input.options,
    input.repository,
    remainingTime(input.deadline),
    input.signal,
    "switch",
  );
  const [head, target] = await Promise.all([
    runGitInspectProcess(
      input.options,
      gitHeadCommitArguments(input.repository),
      remainingTime(input.deadline),
      input.signal,
    ),
    runGitInspectProcess(
      input.options,
      gitRefCommitArguments(input.repository, input.targetRef),
      remainingTime(input.deadline),
      input.signal,
    ),
  ]);
  const headCommitSha1 = requireCommit(head, "current HEAD");
  const targetCommitSha1 = requireCommit(target, "target branch");
  if (
    headCommitSha1 !== targetCommitSha1 ||
    (input.expectedCommitSha1 && headCommitSha1 !== input.expectedCommitSha1)
  ) {
    throw new Error(
      "Git branch switch requires the target at the exact current HEAD",
    );
  }
  const processes = [config, head, target];
  return {
    evidence: gitBranchSwitchProcessEvidence(headCommitSha1, processes),
    processes,
  };
}

export async function assertGitBranchSwitchState(
  repository: GitRepository,
  expectedRepository: GitRepositoryState,
  expectedHeadReflog: GitBoundFile,
): Promise<void> {
  const [repositoryState, headReflog] = await Promise.all([
    snapshotGitRepository(repository),
    snapshotGitHeadReflog(repository),
  ]);
  if (
    repositoryState.stateSha256 !== expectedRepository.stateSha256 ||
    boundFileStateSha256(headReflog) !==
      boundFileStateSha256(expectedHeadReflog)
  ) {
    throw new Error(
      "Git branch switch preview is stale; preview the switch again",
    );
  }
}

function boundFileStateSha256(value: GitBoundFile): string {
  return sha256(
    canonicalJson({
      present: value.present,
      sha256: value.sha256,
      bytes: value.bytes,
      mode: value.mode,
    }),
  );
}

export function gitBranchSwitchProcessEvidence(
  commitSha1: string,
  processes: GitInspectProcessResult[],
): GitBranchSwitchProcessEvidence {
  return {
    commitSha1,
    sandboxSha256: sha256(
      canonicalJson(processes.map((item) => item.sandboxSha256)),
    ),
    executableSha256: sha256(
      canonicalJson(processes.map((item) => item.executableSha256)),
    ),
    environmentSha256: sha256(
      canonicalJson(processes.map((item) => item.environmentSha256)),
    ),
    resourceLimitsSha256: sha256(
      canonicalJson(processes.map((item) => item.resourceLimitsSha256)),
    ),
    durationMs: processes.reduce((total, item) => total + item.durationMs, 0),
  };
}

function requireCommit(result: GitInspectProcessResult, label: string): string {
  const value = result.stdout.trim();
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    !/^[a-f0-9]{40}$/u.test(value)
  ) {
    throw new Error(`Git branch switch ${label} is unavailable`);
  }
  return value;
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git branch switch timed out");
  return remaining;
}
