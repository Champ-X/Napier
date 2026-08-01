import type { LspRenameCommitOutcome } from "./lsp-rename-commit.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import type { SubagentWorktreeChange } from "./subagent-worktree-diff.js";
import {
  commitWorkspaceChanges,
  type CommitWorkspaceChangesOptions,
} from "./workspace-change-commit.js";

export async function commitSubagentWorktreeChanges(input: {
  workspaceRoot: string;
  dataRoot: string;
  source: {
    sourcePreviewResultSha256: string;
    changes: SubagentWorktreeChange[];
    files: LspRenameFile[];
  };
  signal?: AbortSignal;
  commitChanges?: typeof commitWorkspaceChanges;
  commitOptions?: Pick<
    CommitWorkspaceChangesOptions,
    "renameFile" | "linkFile" | "unlinkFile"
  >;
}): Promise<LspRenameCommitOutcome> {
  const commit = input.commitChanges ?? commitWorkspaceChanges;
  const outcome = await commit({
    workspaceRoot: input.workspaceRoot,
    dataRoot: input.dataRoot,
    sourcePreviewResultSha256: input.source.sourcePreviewResultSha256,
    changes: input.source.changes.map((change) => ({
      path: change.path,
      pathSha256: change.pathSha256,
      beforeSha256: change.beforeSha256,
      afterSha256: change.afterSha256,
      ...(change.afterText !== undefined ? { content: change.afterText } : {}),
      ...(change.mode !== undefined ? { mode: change.mode } : {}),
    })),
    ...(input.signal ? { signal: input.signal } : {}),
    ...(input.commitOptions ?? {}),
  });
  const modifiedPathHashes = new Set(
    input.source.files.map((file) => file.pathSha256),
  );
  return {
    ...outcome,
    editCount: input.source.changes.length,
    expectedFiles: outcome.expectedFiles
      .filter(
        (
          file,
        ): file is typeof file & {
          beforeSha256: string;
          expectedSha256: string;
        } =>
          file.beforeSha256 !== null &&
          file.expectedSha256 !== null &&
          modifiedPathHashes.has(file.pathSha256),
      )
      .map((file) => ({
        path: file.path,
        pathSha256: file.pathSha256,
        beforeSha256: file.beforeSha256,
        expectedSha256: file.expectedSha256,
      })),
  };
}
