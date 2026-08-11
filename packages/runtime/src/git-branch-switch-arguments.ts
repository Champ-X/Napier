import { canonicalJson, sha256 } from "./ed25519.js";
import {
  commonGitArguments,
  gitConfigPolicyArguments,
  gitConfigPolicySha256,
  gitHeadCommitArguments,
  gitRefCommitArguments,
  type GitArgumentRepository,
} from "./git-inspect-arguments.js";

export const GIT_BRANCH_SWITCH_REFLOG_MESSAGE = "napier switch branch";
export const MINIMUM_GIT_BRANCH_SWITCH_VERSION = "2.46.0";

export function gitBranchSwitchVersionArguments(): string[] {
  return ["--version"];
}

export function gitSwitchBranchArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    ...commonGitArguments(repository),
    "-c",
    "core.logAllRefUpdates=true",
    "update-ref",
    "--no-deref",
    "-m",
    GIT_BRANCH_SWITCH_REFLOG_MESSAGE,
    "--stdin",
  ];
}

export function gitBranchSwitchTransactionInput(
  targetBranchRef: string,
  sourceCommitSha1: string,
  targetCommitSha1 = sourceCommitSha1,
): string {
  if (
    (!targetBranchRef.startsWith("refs/heads/") &&
      !targetBranchRef.startsWith("$")) ||
    /\s/u.test(targetBranchRef)
  ) {
    throw new Error("Git branch switch transaction ref is invalid");
  }
  for (const commitSha1 of [sourceCommitSha1, targetCommitSha1]) {
    if (
      commitSha1 !== "$COMMIT_SHA1" &&
      commitSha1 !== "$SOURCE_COMMIT_SHA1" &&
      commitSha1 !== "$TARGET_COMMIT_SHA1" &&
      !/^[a-f0-9]{40}$/u.test(commitSha1)
    ) {
      throw new Error("Git branch switch transaction commit is invalid");
    }
  }
  return [
    "start",
    `verify ${targetBranchRef} ${targetCommitSha1}`,
    `symref-update HEAD ${targetBranchRef} oid ${sourceCommitSha1}`,
    "prepare",
    "commit",
    "",
  ].join("\n");
}

export function gitBranchSwitchArgumentsSha256(
  repository: GitArgumentRepository,
): string {
  return sha256(
    canonicalJson({
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("switch"),
      runtimeVersion: {
        arguments: gitBranchSwitchVersionArguments(),
        minimum: MINIMUM_GIT_BRANCH_SWITCH_VERSION,
      },
      head: gitHeadCommitArguments(repository),
      target: gitRefCommitArguments(repository, "$TARGET_BRANCH_REF"),
      switch: gitSwitchBranchArguments(repository),
      sameCommitTransaction: gitBranchSwitchTransactionInput(
        "$TARGET_BRANCH_REF",
        "$COMMIT_SHA1",
      ),
      divergentTransaction: gitBranchSwitchTransactionInput(
        "$TARGET_BRANCH_REF",
        "$SOURCE_COMMIT_SHA1",
        "$TARGET_COMMIT_SHA1",
      ),
    }),
  );
}
