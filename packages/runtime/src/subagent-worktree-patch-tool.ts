import type { AgentTool } from "@earendil-works/pi-agent-core";

import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";
import { applyWorkspacePatch, type WorkspacePatchInput } from "./tools.js";
import { createWorkspacePatchTool } from "./workspace-patch-tool.js";

export function createSubagentWorktreePatchTool(
  session: SubagentWorktreeSession,
  dataRoot: string,
  runMutation: <T>(operation: () => Promise<T>) => Promise<T>,
): AgentTool {
  return createWorkspacePatchTool({
    workspaceRoot: session.root,
    dataRoot,
    applyPatch: async (workspaceRoot, patchDataRoot, input) =>
      runMutation(async () => {
        assertAuthorizedPatch(session, input);
        return applyWorkspacePatch(workspaceRoot, patchDataRoot, input);
      }),
  });
}

function assertAuthorizedPatch(
  session: SubagentWorktreeSession,
  input: WorkspacePatchInput,
): void {
  if (
    !session.writePaths.includes(input.path) ||
    (input.operation === "create" && input.createParentDirectories === true)
  ) {
    throw new Error(
      "Coder Subagent apply_patch is limited to declared file paths with existing parent directories",
    );
  }
}
