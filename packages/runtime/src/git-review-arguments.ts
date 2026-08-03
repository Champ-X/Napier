import { canonicalJson, sha256 } from "./ed25519.js";
import {
  commonGitArguments,
  gitConfigPolicyArguments,
  gitConfigPolicySha256,
  gitHeadCommitArguments,
  gitRefCommitArguments,
  type GitArgumentRepository,
} from "./git-inspect-arguments.js";
import {
  GIT_REVIEW_CONTEXT_LINES,
  GIT_REVIEW_REFLOG_MESSAGE,
} from "./git-review-model.js";

export function gitReviewAncestryArguments(
  repository: GitArgumentRepository,
  targetCommitSha1: string,
  sourceCommitSha1: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "merge-base",
    "--is-ancestor",
    targetCommitSha1,
    sourceCommitSha1,
  ];
}

export function gitReviewCommitRangeArguments(
  repository: GitArgumentRepository,
  targetCommitSha1: string,
  sourceCommitSha1: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "rev-list",
    "--parents",
    "--reverse",
    `${targetCommitSha1}..${sourceCommitSha1}`,
  ];
}

export function gitReviewDirectRefArguments(
  repository: GitArgumentRepository,
  branchRef: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "symbolic-ref",
    "--quiet",
    branchRef,
  ];
}

export function gitReviewRawArguments(
  repository: GitArgumentRepository,
  targetCommitSha1: string,
  sourceCommitSha1: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "diff",
    "--raw",
    "-z",
    "--abbrev=40",
    "--no-renames",
    targetCommitSha1,
    sourceCommitSha1,
  ];
}

export function gitReviewPatchArguments(
  repository: GitArgumentRepository,
  targetCommitSha1: string,
  sourceCommitSha1: string,
  contextLines: number,
): string[] {
  return [
    ...commonGitArguments(repository),
    "diff",
    "--patch",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--ignore-submodules=all",
    "--no-renames",
    `--unified=${contextLines}`,
    targetCommitSha1,
    sourceCommitSha1,
  ];
}

export function gitReviewBlobArguments(
  repository: GitArgumentRepository,
  blobSha1: string,
): string[] {
  return [...commonGitArguments(repository), "cat-file", "blob", blobSha1];
}

export function gitReviewPromoteArguments(
  repository: GitArgumentRepository,
  targetBranchRef: string,
  sourceCommitSha1: string,
  targetCommitSha1: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "update-ref",
    "--no-deref",
    "-m",
    GIT_REVIEW_REFLOG_MESSAGE,
    targetBranchRef,
    sourceCommitSha1,
    targetCommitSha1,
  ];
}

export function gitReviewArgumentsSha256(
  repository: GitArgumentRepository,
): string {
  return sha256(
    canonicalJson({
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("branch"),
      head: gitHeadCommitArguments(repository),
      sourceRef: gitRefCommitArguments(repository, "$SOURCE_BRANCH_REF"),
      targetRef: gitRefCommitArguments(repository, "$TARGET_BRANCH_REF"),
      sourceDirectRef: gitReviewDirectRefArguments(
        repository,
        "$SOURCE_BRANCH_REF",
      ),
      targetDirectRef: gitReviewDirectRefArguments(
        repository,
        "$TARGET_BRANCH_REF",
      ),
      ancestry: gitReviewAncestryArguments(
        repository,
        "$TARGET_COMMIT_SHA1",
        "$SOURCE_COMMIT_SHA1",
      ),
      commitRange: gitReviewCommitRangeArguments(
        repository,
        "$TARGET_COMMIT_SHA1",
        "$SOURCE_COMMIT_SHA1",
      ),
      raw: gitReviewRawArguments(
        repository,
        "$TARGET_COMMIT_SHA1",
        "$SOURCE_COMMIT_SHA1",
      ),
      patch: gitReviewPatchArguments(
        repository,
        "$TARGET_COMMIT_SHA1",
        "$SOURCE_COMMIT_SHA1",
        GIT_REVIEW_CONTEXT_LINES,
      ),
      blob: gitReviewBlobArguments(repository, "$BLOB_SHA1"),
      promote: gitReviewPromoteArguments(
        repository,
        "$TARGET_BRANCH_REF",
        "$SOURCE_COMMIT_SHA1",
        "$TARGET_COMMIT_SHA1",
      ),
    }),
  );
}
