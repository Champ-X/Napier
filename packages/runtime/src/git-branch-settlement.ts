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
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";

const SHA1 = /^[a-f0-9]{40}$/u;
const MAX_SETTLEMENT_TIMEOUT_MS = 5_000;

export interface GitBranchSettlement {
  headCommitSha1?: string;
  branchCommitSha1?: string;
  verified: boolean;
  afterState?: GitRepositoryState;
  processes: GitInspectProcessResult[];
}

export async function settleGitBranchCreate(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  branchRef: string;
  targetCommitSha1: string;
  repositoryState: GitRepositoryState;
  deadline: number;
}): Promise<GitBranchSettlement> {
  const processes: GitInspectProcessResult[] = [];
  const timeoutMs = settlementTimeout(input.deadline);
  const [afterState, head, branch] = await Promise.all([
    snapshotGitRepository(input.repository).catch(() => undefined),
    runGitInspectProcess(
      input.options,
      gitHeadCommitArguments(input.repository),
      timeoutMs,
    ).catch(() => undefined),
    runGitInspectProcess(
      input.options,
      gitRefCommitArguments(input.repository, input.branchRef),
      timeoutMs,
    ).catch(() => undefined),
  ]);
  if (head) processes.push(head);
  if (branch) processes.push(branch);
  const headCommitSha1 = observedCommit(head);
  const branchCommitSha1 = observedCommit(branch);
  const verified =
    afterState?.stateSha256 === input.repositoryState.stateSha256 &&
    headCommitSha1 === input.targetCommitSha1 &&
    branchCommitSha1 === input.targetCommitSha1;
  return {
    ...(headCommitSha1 ? { headCommitSha1 } : {}),
    ...(branchCommitSha1 ? { branchCommitSha1 } : {}),
    verified,
    ...(afterState ? { afterState } : {}),
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
