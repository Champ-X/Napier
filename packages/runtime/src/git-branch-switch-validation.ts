import { canonicalJson, sha256 } from "./ed25519.js";
import { assertGitConfigPolicy } from "./git-config-policy.js";
import {
  gitBranchSwitchVersionArguments,
  MINIMUM_GIT_BRANCH_SWITCH_VERSION,
} from "./git-branch-switch-arguments.js";
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
  sourceCommitSha1: string;
  targetCommitSha1: string;
  configProcess: GitInspectProcessResult;
  evidence: GitBranchSwitchProcessEvidence;
  processes: GitInspectProcessResult[];
}

export async function prepareGitBranchSwitch(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  targetRef: string;
  expectedSourceCommitSha1?: string;
  expectedTargetCommitSha1?: string;
  deadline: number;
  signal?: AbortSignal;
}): Promise<PreparedGitBranchSwitch> {
  const version = await runGitInspectProcess(
    input.options,
    gitBranchSwitchVersionArguments(),
    remainingTime(input.deadline),
    input.signal,
  );
  assertGitBranchSwitchVersion(version);
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
    (input.expectedSourceCommitSha1 &&
      headCommitSha1 !== input.expectedSourceCommitSha1) ||
    (input.expectedTargetCommitSha1 &&
      targetCommitSha1 !== input.expectedTargetCommitSha1)
  ) {
    throw new Error("Git branch switch commit state changed");
  }
  const processes = [version, config, head, target];
  return {
    sourceCommitSha1: headCommitSha1,
    targetCommitSha1,
    configProcess: config,
    evidence: gitBranchSwitchProcessEvidence(
      headCommitSha1,
      targetCommitSha1,
      processes,
    ),
    processes,
  };
}

function assertGitBranchSwitchVersion(result: GitInspectProcessResult): void {
  const match =
    /^git version ([0-9]+)\.([0-9]+)\.([0-9]+)(?:[^\r\n]*)?\n?$/u.exec(
      result.stdout,
    );
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    !match ||
    !versionAtLeast(
      match.slice(1, 4).map(Number),
      MINIMUM_GIT_BRANCH_SWITCH_VERSION.split(".").map(Number),
    )
  ) {
    throw new Error(
      `Git branch switch requires Git ${MINIMUM_GIT_BRANCH_SWITCH_VERSION} or newer`,
    );
  }
}

function versionAtLeast(observed: number[], minimum: number[]): boolean {
  for (let index = 0; index < minimum.length; index += 1) {
    if (observed[index] !== minimum[index]) {
      return (observed[index] ?? -1) > (minimum[index] ?? -1);
    }
  }
  return true;
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
  sourceCommitSha1: string,
  targetCommitSha1: string,
  processes: GitInspectProcessResult[],
): GitBranchSwitchProcessEvidence {
  return {
    sourceCommitSha1,
    commitSha1: targetCommitSha1,
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
