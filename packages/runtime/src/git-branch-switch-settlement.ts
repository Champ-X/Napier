import {
  GIT_BRANCH_SWITCH_REFLOG_MESSAGE,
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
import {
  gitBranchRefWritePaths,
  gitHeadSwitchWritePaths,
  verifyGitHeadSwitchReflog,
} from "./git-ref-files.js";

const SHA1 = /^[a-f0-9]{40}$/u;
const MAX_SETTLEMENT_TIMEOUT_MS = 5_000;

export interface GitBranchSwitchSettlement {
  headCommitSha1?: string;
  targetCommitSha1?: string;
  verified: boolean;
  afterState?: GitRepositoryState;
  afterHeadReflog?: GitBoundFile;
  processes: GitInspectProcessResult[];
}

export async function settleGitBranchSwitch(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  targetRef: string;
  commitSha1: string;
  repositoryState: GitRepositoryState;
  headReflogState: GitBoundFile;
  deadline: number;
}): Promise<GitBranchSwitchSettlement> {
  const timeoutMs = settlementTimeout(input.deadline);
  const [afterState, afterHeadReflog, head, target, canonicalStorage] =
    await Promise.all([
      snapshotGitRepository(input.repository).catch(() => undefined),
      verifyGitHeadSwitchReflog({
        repository: input.repository,
        beforeHeadReflog: input.headReflogState,
        commitSha1: input.commitSha1,
        message: GIT_BRANCH_SWITCH_REFLOG_MESSAGE,
      }).catch(() => undefined),
      runGitInspectProcess(
        input.options,
        gitHeadCommitArguments(input.repository),
        timeoutMs,
      ).catch(() => undefined),
      runGitInspectProcess(
        input.options,
        gitRefCommitArguments(input.repository, input.targetRef),
        timeoutMs,
      ).catch(() => undefined),
      Promise.all([
        gitBranchRefWritePaths(input.repository, input.targetRef),
        gitHeadSwitchWritePaths(input.repository),
      ])
        .then(() => true)
        .catch(() => false),
    ]);
  const processes = [head, target].filter(
    (item): item is GitInspectProcessResult => item !== undefined,
  );
  const headCommitSha1 = observedCommit(head);
  const targetCommitSha1 = observedCommit(target);
  const verified =
    canonicalStorage &&
    afterState?.currentRef === input.targetRef &&
    afterState.staticStateSha256 === input.repositoryState.staticStateSha256 &&
    afterState.index.sha256 === input.repositoryState.index.sha256 &&
    afterHeadReflog !== undefined &&
    afterHeadReflog.sha256 !== input.headReflogState.sha256 &&
    afterHeadReflog.bytes > input.headReflogState.bytes &&
    afterHeadReflog.mode === input.headReflogState.mode &&
    headCommitSha1 === input.commitSha1 &&
    targetCommitSha1 === input.commitSha1;
  return {
    ...(headCommitSha1 ? { headCommitSha1 } : {}),
    ...(targetCommitSha1 ? { targetCommitSha1 } : {}),
    verified,
    ...(afterState ? { afterState } : {}),
    ...(afterHeadReflog ? { afterHeadReflog } : {}),
    processes,
  };
}

function settlementTimeout(deadline: number): number {
  return Math.max(
    1,
    Math.min(MAX_SETTLEMENT_TIMEOUT_MS, deadline - Date.now()),
  );
}

function observedCommit(
  result: GitInspectProcessResult | undefined,
): string | undefined {
  const value = result?.stdout.trim();
  return result?.status === "succeeded" &&
    result.stderr.length === 0 &&
    value !== undefined &&
    SHA1.test(value)
    ? value
    : undefined;
}
