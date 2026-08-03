import { canonicalJson, sha256 } from "./ed25519.js";

const ZERO_GIT_OBJECT_ID = "0000000000000000000000000000000000000000";
export const GIT_BRANCH_SWITCH_REFLOG_MESSAGE = "napier switch branch";

const CONFIG_POLICY_EXACT_KEYS = [
  "include.path",
  "core.attributesfile",
  "core.sparsecheckout",
  "core.sparsecheckoutcone",
  "core.splitindex",
  "extensions.objectformat",
  "extensions.refstorage",
  "extensions.worktreeconfig",
] as const;
const CONFIG_POLICY_PATTERNS = [
  "^includeif\\..+\\.path$",
  "^filter\\..+\\.(?:clean|smudge|process)$",
  "^diff\\..+\\.(?:command|textconv)$",
] as const;
const STAGE_CONFIG_POLICY_EXACT_KEYS = ["core.sharedrepository"] as const;
const CONFIG_POLICY_REGEX = CONFIG_POLICY_PATTERNS.map(
  (source) => new RegExp(source, "u"),
);

export interface GitArgumentRepository {
  root: string;
  gitDirectory: string;
}

export type GitArgumentRequest =
  | { action: "status" }
  | {
      action: "conflict";
      path: string;
    }
  | {
      action: "diff";
      scope: "working" | "staged";
      path?: string;
      contextLines?: number;
    };

export function gitConfigPolicyArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    ...commonGitArguments(repository),
    "config",
    "--local",
    "--no-includes",
    "--name-only",
    "--list",
  ];
}

export function gitInspectArguments(
  repository: GitArgumentRepository,
  request: GitArgumentRequest,
): string[] {
  const common = commonGitArguments(repository);
  if (request.action === "status") {
    return [
      ...common,
      "status",
      "--porcelain=v2",
      "--branch",
      "--untracked-files=all",
      "--ignore-submodules=all",
    ];
  }
  if (request.action === "conflict") {
    throw new Error("Git conflict inspection uses bounded index parsing");
  }
  return [
    ...common,
    "diff",
    ...(request.scope === "staged" ? ["--cached"] : []),
    "--patch",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--ignore-submodules=all",
    `--unified=${request.contextLines ?? 3}`,
    "--",
    ...(request.path ? [request.path] : []),
  ];
}

export function gitConflictBlobArguments(
  repository: GitArgumentRepository,
  blobSha1: string,
): string[] {
  if (blobSha1 !== "$BLOB_SHA1" && !/^[a-f0-9]{40}$/u.test(blobSha1)) {
    throw new Error("Git conflict blob is invalid");
  }
  return [...commonGitArguments(repository), "cat-file", "blob", blobSha1];
}

export function gitInspectionArgumentsSha256(
  repository: GitArgumentRepository,
  request: GitArgumentRequest,
): string {
  if (request.action === "conflict") {
    return sha256(
      canonicalJson({
        configPolicyArguments: gitConfigPolicyArguments(repository),
        configPolicySha256: gitConfigPolicySha256("inspection"),
        indexParser: {
          schemaVersion: 1,
          formats: ["DIRC-v2-sha1", "DIRC-v3-sha1"],
          targetPath: request.path,
        },
        blob: gitConflictBlobArguments(repository, "$BLOB_SHA1"),
      }),
    );
  }
  return sha256(
    canonicalJson({
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("inspection"),
      inspection: gitInspectArguments(repository, request),
    }),
  );
}

export function gitStageAddArguments(
  repository: GitArgumentRepository,
  targetPath: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "-c",
    "advice.addIgnoredFile=false",
    "add",
    "--",
    targetPath,
  ];
}

export function gitStageDiffArguments(
  repository: GitArgumentRepository,
  targetPath: string,
  contextLines: number,
): string[] {
  return [
    ...commonGitArguments(repository),
    "diff",
    "--cached",
    "HEAD",
    "--patch",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--ignore-submodules=all",
    `--unified=${contextLines}`,
    "--",
    targetPath,
  ];
}

export function gitStageArgumentsSha256(
  repository: GitArgumentRepository,
  targetPath: string,
  contextLines: number,
): string {
  return sha256(
    canonicalJson({
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("stage"),
      add: gitStageAddArguments(repository, targetPath),
      diff: gitStageDiffArguments(repository, targetPath, contextLines),
    }),
  );
}
export function gitHeadCommitArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    ...commonGitArguments(repository),
    "rev-parse",
    "--verify",
    "HEAD^{commit}",
  ];
}
export function gitRefCommitArguments(
  repository: GitArgumentRepository,
  branchRef: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "rev-parse",
    "--verify",
    `${branchRef}^{commit}`,
  ];
}
export function gitStagedDiffArguments(
  repository: GitArgumentRepository,
  contextLines: number,
): string[] {
  return [
    ...commonGitArguments(repository),
    "diff",
    "--cached",
    "HEAD",
    "--patch",
    "--no-ext-diff",
    "--no-textconv",
    "--no-color",
    "--ignore-submodules=all",
    `--unified=${contextLines}`,
    "--",
  ];
}
export function gitStagedRawArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    ...commonGitArguments(repository),
    "diff",
    "--cached",
    "--raw",
    "-z",
    "--no-renames",
    "HEAD",
    "--",
  ];
}
export function gitWriteTreeArguments(
  repository: GitArgumentRepository,
): string[] {
  return [...commonGitArguments(repository), "write-tree"];
}

export function gitCommitTreeArguments(
  repository: GitArgumentRepository,
  treeSha1: string,
  parentCommitSha1: string,
  messageFile: string,
): string[] {
  return gitCommitTreeWithParentsArguments(
    repository,
    treeSha1,
    [parentCommitSha1],
    messageFile,
  );
}

export function gitCommitTreeWithParentsArguments(
  repository: GitArgumentRepository,
  treeSha1: string,
  parentCommitSha1s: string[],
  messageFile: string,
): string[] {
  if (
    parentCommitSha1s.length < 1 ||
    parentCommitSha1s.length > 2 ||
    parentCommitSha1s.some(
      (parent) =>
        parent !== "$PARENT_SHA1" &&
        parent !== "$MERGE_PARENT_SHA1" &&
        !/^[a-f0-9]{40}$/u.test(parent),
    )
  ) {
    throw new Error("Git commit parent set is invalid");
  }
  return [
    ...commonGitArguments(repository),
    "commit-tree",
    treeSha1,
    ...parentCommitSha1s.flatMap((parent) => ["-p", parent]),
    "-F",
    messageFile,
  ];
}

export function gitUpdateBranchArguments(
  repository: GitArgumentRepository,
  branchRef: string,
  commitSha1: string,
  parentCommitSha1: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "-c",
    "core.logAllRefUpdates=true",
    "update-ref",
    "-m",
    "napier atomic commit",
    branchRef,
    commitSha1,
    parentCommitSha1,
  ];
}

export function gitRefExistsArguments(
  repository: GitArgumentRepository,
  branchRef: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "show-ref",
    "--verify",
    "--quiet",
    branchRef,
  ];
}

export function gitCreateBranchArguments(
  repository: GitArgumentRepository,
  branchRef: string,
  targetCommitSha1: string,
): string[] {
  return [
    ...commonGitArguments(repository),
    "-c",
    "core.logAllRefUpdates=true",
    "update-ref",
    "-m",
    "napier create branch",
    branchRef,
    targetCommitSha1,
    ZERO_GIT_OBJECT_ID,
  ];
}

export function gitBranchArgumentsSha256(
  repository: GitArgumentRepository,
): string {
  return sha256(
    canonicalJson({
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("branch"),
      head: gitHeadCommitArguments(repository),
      exists: gitRefExistsArguments(repository, "$BRANCH_REF"),
      create: gitCreateBranchArguments(
        repository,
        "$BRANCH_REF",
        "$TARGET_COMMIT_SHA1",
      ),
      settle: gitRefCommitArguments(repository, "$BRANCH_REF"),
    }),
  );
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
  commitSha1: string,
): string {
  for (const branchRef of [targetBranchRef]) {
    if (
      (!branchRef.startsWith("refs/heads/") && !branchRef.startsWith("$")) ||
      /\s/u.test(branchRef)
    ) {
      throw new Error("Git branch switch transaction ref is invalid");
    }
  }
  if (commitSha1 !== "$COMMIT_SHA1" && !/^[a-f0-9]{40}$/u.test(commitSha1)) {
    throw new Error("Git branch switch transaction commit is invalid");
  }
  return [
    "start",
    `verify ${targetBranchRef} ${commitSha1}`,
    `symref-update HEAD ${targetBranchRef} oid ${commitSha1}`,
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
      head: gitHeadCommitArguments(repository),
      target: gitRefCommitArguments(repository, "$TARGET_BRANCH_REF"),
      switch: gitSwitchBranchArguments(repository),
      transaction: gitBranchSwitchTransactionInput(
        "$TARGET_BRANCH_REF",
        "$COMMIT_SHA1",
      ),
    }),
  );
}

export function gitCommitArgumentsSha256(
  repository: GitArgumentRepository,
  contextLines: number,
): string {
  return sha256(
    canonicalJson({
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("commit"),
      head: gitHeadCommitArguments(repository),
      branch: gitRefCommitArguments(repository, "$BRANCH_REF"),
      stagedRaw: gitStagedRawArguments(repository),
      stagedDiff: gitStagedDiffArguments(repository, contextLines),
      writeTree: gitWriteTreeArguments(repository),
      commitTree: gitCommitTreeArguments(
        repository,
        "$TREE_SHA1",
        "$PARENT_SHA1",
        "$PRIVATE_MESSAGE_FILE",
      ),
      mergeCommitTree: gitCommitTreeWithParentsArguments(
        repository,
        "$TREE_SHA1",
        ["$PARENT_SHA1", "$MERGE_PARENT_SHA1"],
        "$PRIVATE_MESSAGE_FILE",
      ),
      updateBranch: gitUpdateBranchArguments(
        repository,
        "$BRANCH_REF",
        "$COMMIT_SHA1",
        "$PARENT_SHA1",
      ),
    }),
  );
}

export function gitConfigKeysPermitInspection(output: string): boolean {
  return configKeys(output).every(
    (key) =>
      !CONFIG_POLICY_EXACT_KEYS.includes(
        key as (typeof CONFIG_POLICY_EXACT_KEYS)[number],
      ) && !CONFIG_POLICY_REGEX.some((pattern) => pattern.test(key)),
  );
}

export function gitConfigKeysPermitStage(output: string): boolean {
  return (
    gitConfigKeysPermitInspection(output) &&
    !configKeys(output).some((key) =>
      STAGE_CONFIG_POLICY_EXACT_KEYS.includes(
        key as (typeof STAGE_CONFIG_POLICY_EXACT_KEYS)[number],
      ),
    )
  );
}

export function gitConfigPolicySha256(
  operation: "inspection" | "stage" | "commit" | "branch" | "switch",
): string {
  return sha256(
    canonicalJson({
      schemaVersion: 1,
      exactKeys: CONFIG_POLICY_EXACT_KEYS,
      patterns: CONFIG_POLICY_PATTERNS,
      stageExactKeys:
        operation === "inspection" ? [] : STAGE_CONFIG_POLICY_EXACT_KEYS,
    }),
  );
}

function configKeys(output: string): string[] {
  return output
    .split("\n")
    .map((key) => key.trim().toLowerCase())
    .filter(Boolean);
}

export function commonGitArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    "--no-pager",
    "--no-optional-locks",
    "--literal-pathspecs",
    `--git-dir=${repository.gitDirectory}`,
    `--work-tree=${repository.root}`,
    "-c",
    "color.ui=false",
    "-c",
    "core.fsmonitor=false",
    "-c",
    "core.hooksPath=/dev/null",
    "-c",
    "diff.algorithm=myers",
    "-c",
    "diff.renames=false",
  ];
}
