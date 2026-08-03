import { canonicalJson, sha256 } from "./ed25519.js";
import {
  commonGitArguments,
  gitConfigPolicyArguments,
  gitConfigPolicySha256,
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
  targetPath: string,
  contextLines: number,
  selectionMode: "path" | "hunks",
  hunkSelectionSha256: string,
): string {
  if (selectionMode === "path") {
    return gitStageArgumentsSha256(repository, targetPath, contextLines);
  }
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
