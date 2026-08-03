import { canonicalJson, sha256 } from "./ed25519.js";
import {
  commonGitArguments,
  gitConfigPolicyArguments,
  gitConfigPolicySha256,
  gitStageAddArguments,
  gitStageArgumentsSha256,
  gitStageDiffArguments,
  type GitArgumentRepository,
} from "./git-inspect-arguments.js";
import { GIT_STAGE_HUNK_PROTOCOL_SHA256 } from "./git-stage-hunk-patch.js";

export function gitStageWorkingDiffArguments(
  repository: GitArgumentRepository,
  targetPath: string,
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
    `--unified=${contextLines}`,
    "--",
    targetPath,
  ];
}

export function gitStageApplyPatchArguments(
  repository: GitArgumentRepository,
): string[] {
  return [
    ...commonGitArguments(repository),
    "apply",
    "--cached",
    "--unidiff-zero",
    "--whitespace=nowarn",
    "-",
  ];
}

export function gitStageOperationArgumentsSha256(
  repository: GitArgumentRepository,
  targetPaths: readonly string[],
  contextLines: number,
  selectionMode: "path" | "hunks",
  hunkSelectionSha256: string,
): string {
  if (selectionMode === "path" && targetPaths.length === 1) {
    return gitStageArgumentsSha256(repository, targetPaths[0]!, contextLines);
  }
  if (selectionMode === "path") {
    return sha256(
      canonicalJson({
        configPolicyArguments: gitConfigPolicyArguments(repository),
        configPolicySha256: gitConfigPolicySha256("stage"),
        mode: "ordered_multi_path",
        add: targetPaths.map((targetPath) =>
          gitStageAddArguments(repository, targetPath),
        ),
        stagedDiff: targetPaths.map((targetPath) =>
          gitStageDiffArguments(repository, targetPath, contextLines),
        ),
      }),
    );
  }
  const targetPath = targetPaths[0]!;
  return sha256(
    canonicalJson({
      configPolicyArguments: gitConfigPolicyArguments(repository),
      configPolicySha256: gitConfigPolicySha256("stage"),
      hunkProtocolSha256: GIT_STAGE_HUNK_PROTOCOL_SHA256,
      hunkSelectionSha256,
      workingDiff: gitStageWorkingDiffArguments(
        repository,
        targetPath,
        contextLines,
      ),
      applyPatch: gitStageApplyPatchArguments(repository),
      stagedDiff: gitStageDiffArguments(repository, targetPath, contextLines),
    }),
  );
}
