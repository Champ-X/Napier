import { canonicalJson, sha256 } from "./ed25519.js";
import {
  commonGitArguments,
  type GitArgumentRepository,
} from "./git-inspect-arguments.js";

const SHA1 = /^[a-f0-9]{40}$/u;

export function gitBranchCheckoutStatusArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    ...commonGitArguments(repository),
    "status",
    "--porcelain=v2",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=all",
  ];
}

export function gitBranchCheckoutRawArguments(
  repository: GitArgumentRepository,
  sourceCommitSha1: string,
  targetCommitSha1: string,
): string[] {
  assertCommitPair(sourceCommitSha1, targetCommitSha1);
  return [
    ...commonGitArguments(repository),
    "diff",
    "--raw",
    "-z",
    "--abbrev=40",
    "--no-renames",
    sourceCommitSha1,
    targetCommitSha1,
    "--",
  ];
}

export function gitBranchCheckoutPatchArguments(
  repository: GitArgumentRepository,
  sourceCommitSha1: string,
  targetCommitSha1: string,
  contextLines: number,
): string[] {
  assertCommitPair(sourceCommitSha1, targetCommitSha1);
  if (
    !Number.isSafeInteger(contextLines) ||
    contextLines < 0 ||
    contextLines > 10
  ) {
    throw new Error("Git branch checkout context is invalid");
  }
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
    sourceCommitSha1,
    targetCommitSha1,
    "--",
  ];
}

export function gitBranchCheckoutTreeArguments(
  repository: GitArgumentRepository,
  commitSha1: string,
): string[] {
  assertCommit(commitSha1);
  return [
    ...commonGitArguments(repository),
    "rev-parse",
    "--verify",
    `${commitSha1}^{tree}`,
  ];
}

export function gitBranchCheckoutReadTreeArguments(
  repository: GitArgumentRepository,
  targetCommitSha1: string,
): string[] {
  assertCommit(targetCommitSha1);
  return [
    ...commonGitArguments(repository),
    "read-tree",
    "--reset",
    targetCommitSha1,
  ];
}

export function gitBranchCheckoutWriteTreeArguments(
  repository: GitArgumentRepository,
): string[] {
  return [...commonGitArguments(repository), "write-tree"];
}

export function gitBranchCheckoutBlobArguments(
  repository: GitArgumentRepository,
  blobSha1: string,
): string[] {
  if (blobSha1 !== "$BLOB_SHA1") assertCommit(blobSha1);
  return [...commonGitArguments(repository), "cat-file", "blob", blobSha1];
}

export function gitBranchCheckoutArgumentsSha256(
  repository: GitArgumentRepository,
  contextLines: number,
): string {
  return sha256(
    canonicalJson({
      status: gitBranchCheckoutStatusArguments(repository),
      raw: gitBranchCheckoutRawArguments(
        repository,
        "$SOURCE_COMMIT_SHA1",
        "$TARGET_COMMIT_SHA1",
      ),
      patch: gitBranchCheckoutPatchArguments(
        repository,
        "$SOURCE_COMMIT_SHA1",
        "$TARGET_COMMIT_SHA1",
        contextLines,
      ),
      sourceTree: gitBranchCheckoutTreeArguments(
        repository,
        "$SOURCE_COMMIT_SHA1",
      ),
      targetTree: gitBranchCheckoutTreeArguments(
        repository,
        "$TARGET_COMMIT_SHA1",
      ),
      readTree: gitBranchCheckoutReadTreeArguments(
        repository,
        "$TARGET_COMMIT_SHA1",
      ),
      writeTree: gitBranchCheckoutWriteTreeArguments(repository),
      blob: gitBranchCheckoutBlobArguments(repository, "$BLOB_SHA1"),
    }),
  );
}

function assertCommitPair(source: string, target: string): void {
  assertCommit(source);
  assertCommit(target);
  if (source === target) {
    throw new Error("Git branch checkout commits must differ");
  }
}

function assertCommit(value: string): void {
  if (
    value !== "$SOURCE_COMMIT_SHA1" &&
    value !== "$TARGET_COMMIT_SHA1" &&
    !SHA1.test(value)
  ) {
    throw new Error("Git branch checkout commit is invalid");
  }
}
