import { canonicalJson, sha256 } from "./ed25519.js";
import { assertGitBranchCheckoutBlob } from "./git-branch-switch-checkout-files.js";
import {
  MAX_GIT_BRANCH_CHECKOUT_TOTAL_BYTES,
  parseGitBranchCheckoutRaw,
} from "./git-branch-switch-checkout-model.js";
import { assertGitConfigPolicy } from "./git-config-policy.js";
import {
  gitHeadCommitArguments,
  gitRefCommitArguments,
} from "./git-inspect-arguments.js";
import {
  MAX_GIT_PROCESS_OUTPUT_CHARS,
  runGitInspectProcess,
  type GitInspectProcessOptions,
  type GitInspectProcessResult,
} from "./git-inspect-process.js";
import {
  gitReviewAncestryArguments,
  gitReviewBlobArguments,
  gitReviewCommitRangeArguments,
  gitReviewDirectRefArguments,
  gitReviewPatchArguments,
  gitReviewRawArguments,
} from "./git-review-arguments.js";
import {
  createGitReviewPlan,
  GIT_REVIEW_CONTEXT_LINES,
  MAX_GIT_REVIEW_COMMITS,
  MAX_GIT_REVIEW_FILES,
  MAX_GIT_REVIEW_PATCH_BYTES,
  type GitReviewPlan,
  type GitReviewProcessEvidence,
} from "./git-review-model.js";
import type { GitBoundFile, GitRepository } from "./git-repository.js";
import { gitDiffCounts } from "./git-stage-model.js";

const ZERO_SHA1 = "0".repeat(40);

export interface PreparedGitReview {
  plan: GitReviewPlan;
  patch: string;
  evidence: GitReviewProcessEvidence;
  processes: GitInspectProcessResult[];
}

export async function prepareGitReview(input: {
  options: GitInspectProcessOptions;
  repository: GitRepository;
  sourceBranchRef: string;
  targetBranchRef: string;
  expectedSourceCommitSha1?: string;
  expectedTargetCommitSha1?: string;
  expectedPlanSha256?: string;
  headReflogState: GitBoundFile;
  targetReflogState: GitBoundFile;
  deadline: number;
  signal?: AbortSignal;
}): Promise<PreparedGitReview> {
  const config = await assertGitConfigPolicy(
    input.options,
    input.repository,
    remainingTime(input.deadline),
    input.signal,
    "branch",
  );
  const [head, source, target, sourceDirectRef, targetDirectRef] =
    await inspectParallel(input, [
      inspect(input, gitHeadCommitArguments(input.repository)),
      inspect(
        input,
        gitRefCommitArguments(input.repository, input.sourceBranchRef),
      ),
      inspect(
        input,
        gitRefCommitArguments(input.repository, input.targetBranchRef),
      ),
      inspect(
        input,
        gitReviewDirectRefArguments(input.repository, input.sourceBranchRef),
      ),
      inspect(
        input,
        gitReviewDirectRefArguments(input.repository, input.targetBranchRef),
      ),
    ]);
  assertDirectRef(sourceDirectRef);
  assertDirectRef(targetDirectRef);
  const sourceCommitSha1 = requireCommit(head, "source HEAD");
  const sourceRefCommitSha1 = requireCommit(source, "source branch");
  const targetCommitSha1 = requireCommit(target, "target branch");
  assertCommitBinding(input, {
    sourceCommitSha1,
    sourceRefCommitSha1,
    targetCommitSha1,
  });
  const ancestry = await inspect(
    input,
    gitReviewAncestryArguments(
      input.repository,
      targetCommitSha1,
      sourceCommitSha1,
    ),
  );
  assertEmptySuccess(ancestry, "Git review target is not a source ancestor");
  const commitRangeProcess = await inspect(
    input,
    gitReviewCommitRangeArguments(
      input.repository,
      targetCommitSha1,
      sourceCommitSha1,
    ),
  );
  const commits = requireLinearCommitRange(
    commitRangeProcess,
    targetCommitSha1,
    sourceCommitSha1,
  );
  const transitions = await inspectCommitTransitions(
    input,
    targetCommitSha1,
    commits,
  );
  const counts = gitDiffCounts(transitions.patch);
  if (counts.fileCount !== transitions.entries.length) {
    throw new Error("Git review patch is incomplete");
  }
  const blobProcesses = await verifyReviewBlobs(input, transitions.entries);
  const processes = [
    config,
    head,
    source,
    target,
    sourceDirectRef,
    targetDirectRef,
    ancestry,
    commitRangeProcess,
    ...transitions.processes,
    ...blobProcesses,
  ];
  const plan = createGitReviewPlan({
    sourceBranchRef: input.sourceBranchRef,
    targetBranchRef: input.targetBranchRef,
    sourceCommitSha1,
    targetCommitSha1,
    commitCount: commits.length,
    counts,
    raw: transitions.rawBinding,
    patch: transitions.patch,
    headReflog: input.headReflogState,
    targetReflog: input.targetReflogState,
  });
  if (
    input.expectedPlanSha256 &&
    plan.planSha256 !== input.expectedPlanSha256
  ) {
    throw new Error("Git review preview is stale; preview the review again");
  }
  return {
    plan,
    patch: transitions.patch,
    evidence: gitReviewProcessEvidence(processes),
    processes,
  };
}

async function inspectCommitTransitions(
  input: Parameters<typeof prepareGitReview>[0],
  targetCommitSha1: string,
  commits: string[],
): Promise<{
  rawBinding: string;
  patch: string;
  entries: ReturnType<typeof parseGitBranchCheckoutRaw>;
  processes: GitInspectProcessResult[];
}> {
  const rawBindings = [];
  const patchParts: string[] = [];
  const entries: ReturnType<typeof parseGitBranchCheckoutRaw> = [];
  const processes: GitInspectProcessResult[] = [];
  let parent = targetCommitSha1;
  for (const commit of commits) {
    const [raw, patch] = await inspectParallel(input, [
      inspect(input, gitReviewRawArguments(input.repository, parent, commit)),
      inspect(
        input,
        gitReviewPatchArguments(
          input.repository,
          parent,
          commit,
          GIT_REVIEW_CONTEXT_LINES,
        ),
      ),
    ]);
    assertDiffProcess(raw, "raw delta", 64 * 1024);
    assertDiffProcess(patch, "patch", MAX_GIT_REVIEW_PATCH_BYTES);
    if (
      patch.stdout.includes("Binary files ") ||
      patch.stdout.includes("GIT binary patch")
    ) {
      throw new Error("Git review patch is unsupported");
    }
    const currentEntries = raw.stdout
      ? parseGitBranchCheckoutRaw(raw.stdout)
      : [];
    entries.push(...currentEntries);
    if (entries.length > MAX_GIT_REVIEW_FILES) {
      throw new Error("Git review file transitions exceed their bounded limit");
    }
    rawBindings.push({
      parentCommitSha1: parent,
      commitSha1: commit,
      rawSha256: sha256(raw.stdout),
    });
    patchParts.push(`commit ${commit}\n${patch.stdout || "(no tree delta)\n"}`);
    processes.push(raw, patch);
    parent = commit;
  }
  const reviewPatch = patchParts.join("");
  if (Buffer.byteLength(reviewPatch, "utf8") > MAX_GIT_REVIEW_PATCH_BYTES) {
    throw new Error("Git review patch exceeds its bounded limit");
  }
  return {
    rawBinding: canonicalJson(rawBindings),
    patch: reviewPatch,
    entries,
    processes,
  };
}

async function verifyReviewBlobs(
  input: Parameters<typeof prepareGitReview>[0],
  entries: ReturnType<typeof parseGitBranchCheckoutRaw>,
): Promise<GitInspectProcessResult[]> {
  const objectIds = new Set<string>();
  for (const entry of entries) {
    if (entry.sourceBlobSha1 !== ZERO_SHA1) objectIds.add(entry.sourceBlobSha1);
    if (entry.targetBlobSha1 !== ZERO_SHA1) objectIds.add(entry.targetBlobSha1);
  }
  const processes: GitInspectProcessResult[] = [];
  const bytes = new Map<string, number>();
  for (const objectId of objectIds) {
    const process = await inspect(
      input,
      gitReviewBlobArguments(input.repository, objectId),
    );
    if (process.status !== "succeeded" || process.stderr.length > 0) {
      throw new Error("Git review blob is unavailable");
    }
    const content = Buffer.from(process.stdout, "utf8");
    assertGitBranchCheckoutBlob(content, objectId);
    bytes.set(objectId, content.length);
    processes.push(process);
  }
  let totalBytes = 0;
  for (const entry of entries) {
    totalBytes += bytes.get(entry.sourceBlobSha1) ?? 0;
    totalBytes += bytes.get(entry.targetBlobSha1) ?? 0;
  }
  if (totalBytes > MAX_GIT_BRANCH_CHECKOUT_TOTAL_BYTES) {
    throw new Error("Git review file set exceeds its bounded byte limit");
  }
  return processes;
}

function assertCommitBinding(
  input: Parameters<typeof prepareGitReview>[0],
  commits: {
    sourceCommitSha1: string;
    sourceRefCommitSha1: string;
    targetCommitSha1: string;
  },
): void {
  if (
    commits.sourceCommitSha1 !== commits.sourceRefCommitSha1 ||
    commits.sourceCommitSha1 === commits.targetCommitSha1 ||
    (input.expectedSourceCommitSha1 !== undefined &&
      commits.sourceCommitSha1 !== input.expectedSourceCommitSha1) ||
    (input.expectedTargetCommitSha1 !== undefined &&
      commits.targetCommitSha1 !== input.expectedTargetCommitSha1)
  ) {
    throw new Error("Git review preview is stale; preview the review again");
  }
}

function requireCommit(result: GitInspectProcessResult, label: string): string {
  const value = result.stdout.trim();
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    !/^[a-f0-9]{40}$/u.test(value)
  ) {
    throw new Error(`Git review ${label} is unavailable`);
  }
  return value;
}

function requireLinearCommitRange(
  result: GitInspectProcessResult,
  targetCommitSha1: string,
  sourceCommitSha1: string,
): string[] {
  const lines = result.stdout.trim().split("\n").filter(Boolean);
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    lines.length < 1 ||
    lines.length > MAX_GIT_REVIEW_COMMITS
  ) {
    throw new Error("Git review commit range exceeds its bounded limit");
  }
  const commits: string[] = [];
  let expectedParent = targetCommitSha1;
  for (const line of lines) {
    const fields = line.split(" ");
    if (
      fields.length !== 2 ||
      !/^[a-f0-9]{40}$/u.test(fields[0] ?? "") ||
      fields[1] !== expectedParent
    ) {
      throw new Error("Git review requires one linear non-merge commit range");
    }
    expectedParent = fields[0]!;
    commits.push(fields[0]!);
  }
  if (commits.at(-1) !== sourceCommitSha1) {
    throw new Error("Git review commit range does not reach source HEAD");
  }
  return commits;
}

function assertDirectRef(result: GitInspectProcessResult): void {
  if (
    result.status === "failed" &&
    result.exitCode === 1 &&
    result.stdout.length === 0 &&
    result.stderr.length === 0
  ) {
    return;
  }
  throw new Error("Git review requires direct local branch refs");
}

function assertEmptySuccess(
  result: GitInspectProcessResult,
  message: string,
): void {
  if (
    result.status !== "succeeded" ||
    result.stdout.length > 0 ||
    result.stderr.length > 0
  ) {
    throw new Error(message);
  }
}

function assertDiffProcess(
  result: GitInspectProcessResult,
  label: string,
  maximumBytes: number,
): void {
  if (
    result.status !== "succeeded" ||
    result.stderr.length > 0 ||
    result.stdout.length > MAX_GIT_PROCESS_OUTPUT_CHARS ||
    Buffer.byteLength(result.stdout, "utf8") > maximumBytes
  ) {
    throw new Error(`Git review ${label} exceeds its bounded limit`);
  }
}

export function gitReviewProcessEvidence(
  processes: GitInspectProcessResult[],
): GitReviewProcessEvidence {
  return {
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

async function inspect(
  input: Pick<
    Parameters<typeof prepareGitReview>[0],
    "options" | "repository" | "deadline" | "signal"
  >,
  args: string[],
): Promise<GitInspectProcessResult> {
  return runGitInspectProcess(
    input.options,
    args,
    remainingTime(input.deadline),
    input.signal,
  );
}

async function inspectParallel<const T extends GitInspectProcessResult[]>(
  _input: Parameters<typeof prepareGitReview>[0],
  processes: { [K in keyof T]: Promise<T[K]> },
): Promise<T> {
  const settled = await Promise.allSettled(processes);
  const failure = settled.find(
    (item): item is PromiseRejectedResult => item.status === "rejected",
  );
  if (failure) throw failure.reason;
  return settled.map(
    (item) => (item as PromiseFulfilledResult<GitInspectProcessResult>).value,
  ) as T;
}

function remainingTime(deadline: number): number {
  const remaining = deadline - Date.now();
  if (remaining <= 0) throw new Error("Git review operation timed out");
  return remaining;
}
