import {
  gitHeadCommitArguments,
  gitRefCommitArguments,
} from "./git-inspect-arguments.js";
import {
  runGitInspectProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import { boundFileSha256 } from "./git-review-model.js";
import {
  snapshotGitRepository,
  type GitBoundFile,
  type GitRepository,
  type GitRepositoryState,
} from "./git-repository.js";
import { snapshotGitHeadReflog } from "./git-ref-files.js";

const SHA1 = /^[a-f0-9]{40}$/u;
const MAX_SETTLEMENT_TIMEOUT_MS = 5_000;

export interface GitReviewSettlement {
  headCommitSha1?: string;
  sourceCommitSha1?: string;
  targetCommitSha1?: string;
  verified: boolean;
  afterState?: GitRepositoryState;
  processes: GitInspectProcessResult[];
}

export async function settleGitReviewPromotion(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  sourceBranchRef: string;
  targetBranchRef: string;
  sourceCommitSha1: string;
  repositoryState: GitRepositoryState;
  headReflogState: GitBoundFile;
  deadline: number;
}): Promise<GitReviewSettlement> {
  const timeoutMs = settlementTimeout(input.deadline);
  const [afterState, head, source, target, headReflog] = await Promise.all([
    snapshotGitRepository(input.repository).catch(() => undefined),
    inspect(input, gitHeadCommitArguments(input.repository), timeoutMs),
    inspect(
      input,
      gitRefCommitArguments(input.repository, input.sourceBranchRef),
      timeoutMs,
    ),
    inspect(
      input,
      gitRefCommitArguments(input.repository, input.targetBranchRef),
      timeoutMs,
    ),
    snapshotGitHeadReflog(input.repository).catch(() => undefined),
  ]);
  const processes = [head, source, target].filter(
    (item): item is GitInspectProcessResult => item !== undefined,
  );
  const headCommitSha1 = observedCommit(head);
  const sourceCommitSha1 = observedCommit(source);
  const targetCommitSha1 = observedCommit(target);
  const verified =
    afterState?.stateSha256 === input.repositoryState.stateSha256 &&
    headCommitSha1 === input.sourceCommitSha1 &&
    sourceCommitSha1 === input.sourceCommitSha1 &&
    targetCommitSha1 === input.sourceCommitSha1 &&
    headReflog !== undefined &&
    boundFileSha256(headReflog) === boundFileSha256(input.headReflogState);
  return {
    ...(headCommitSha1 ? { headCommitSha1 } : {}),
    ...(sourceCommitSha1 ? { sourceCommitSha1 } : {}),
    ...(targetCommitSha1 ? { targetCommitSha1 } : {}),
    verified,
    ...(afterState ? { afterState } : {}),
    processes,
  };
}

async function inspect(
  input: Pick<
    Parameters<typeof settleGitReviewPromotion>[0],
    "options" | "repository"
  >,
  args: string[],
  timeoutMs: number,
): Promise<GitInspectProcessResult | undefined> {
  return runGitInspectProcess(input.options, args, timeoutMs).catch(
    () => undefined,
  );
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
