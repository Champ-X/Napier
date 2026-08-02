import {
  gitHeadCommitArguments,
  gitRefCommitArguments,
  gitStagedDiffArguments,
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
import {
  assertSimpleGitCommitState,
  type PreparedGitCommit,
} from "./git-commit-private.js";

const SHA1 = /^[a-f0-9]{40}$/u;
const SETTLEMENT_TIMEOUT_MS = 5_000;

export interface GitCommitSettlement {
  headCommitSha1?: string;
  branchCommitSha1?: string;
  verified: boolean;
  afterState?: GitRepositoryState;
  durationMs: number;
  environmentSha256: string[];
  resourceLimitsSha256: string[];
}

export async function settleGitCommit(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  preview: {
    branchRef: string;
    contextLines: number;
    repositoryState: GitRepositoryState;
  };
  prepared: PreparedGitCommit;
}): Promise<GitCommitSettlement> {
  const processes: GitInspectProcessResult[] = [];
  const [head, branch] = await Promise.all([
    runGitInspectProcess(
      input.options,
      gitHeadCommitArguments(input.repository),
      SETTLEMENT_TIMEOUT_MS,
    ).catch(() => undefined),
    runGitInspectProcess(
      input.options,
      gitRefCommitArguments(input.repository, input.preview.branchRef),
      SETTLEMENT_TIMEOUT_MS,
    ).catch(() => undefined),
  ]);
  if (head) processes.push(head);
  if (branch) processes.push(branch);
  const headCommitSha1 = observedCommit(head);
  const branchCommitSha1 = observedCommit(branch);
  if (branchCommitSha1 !== input.prepared.commitSha1) {
    return processSettlement(
      processes,
      headCommitSha1,
      branchCommitSha1,
      false,
    );
  }
  try {
    const [afterState, diff] = await Promise.all([
      snapshotGitRepository(input.repository),
      runGitInspectProcess(
        input.options,
        gitStagedDiffArguments(input.repository, input.preview.contextLines),
        SETTLEMENT_TIMEOUT_MS,
      ),
      assertSimpleGitCommitState(input.repository),
    ]);
    processes.push(diff);
    const verified =
      headCommitSha1 === input.prepared.commitSha1 &&
      afterState.currentRef === input.preview.branchRef &&
      afterState.staticStateSha256 ===
        input.preview.repositoryState.staticStateSha256 &&
      afterState.index.sha256 === input.preview.repositoryState.index.sha256 &&
      diff.status === "succeeded" &&
      diff.stderr.length === 0 &&
      diff.stdout.length === 0;
    return {
      ...processSettlement(
        processes,
        headCommitSha1,
        branchCommitSha1,
        verified,
      ),
      afterState,
    };
  } catch {
    return processSettlement(
      processes,
      headCommitSha1,
      branchCommitSha1,
      false,
    );
  }
}

function processSettlement(
  processes: GitInspectProcessResult[],
  headCommitSha1: string | undefined,
  branchCommitSha1: string | undefined,
  verified: boolean,
): GitCommitSettlement {
  return {
    ...(headCommitSha1 ? { headCommitSha1 } : {}),
    ...(branchCommitSha1 ? { branchCommitSha1 } : {}),
    verified,
    durationMs: processes.reduce((total, item) => total + item.durationMs, 0),
    environmentSha256: processes.map((item) => item.environmentSha256),
    resourceLimitsSha256: processes.map((item) => item.resourceLimitsSha256),
  };
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
