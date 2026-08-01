import type { AgentTool } from "@earendil-works/pi-agent-core";

import { LspCodeActionApplyDiagnostics } from "./lsp-code-action-apply-diagnostics.js";
import { createLspCodeActionApplyTool } from "./lsp-code-action-apply-tool.js";
import { LspCodeActionMutationManager } from "./lsp-code-action-mutation-manager.js";
import { createLspCodeActionsTool } from "./lsp-code-actions-tool.js";
import { createLspDefinitionTool } from "./lsp-definition-tool.js";
import { createLspReferencesTool } from "./lsp-references-tool.js";
import { LspRenameApplyDiagnostics } from "./lsp-rename-apply-diagnostics.js";
import { createLspRenameApplyTool } from "./lsp-rename-apply-tool.js";
import { LspRenameMutationManager } from "./lsp-rename-mutation-manager.js";
import { createLspRenameTool } from "./lsp-rename-tool.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import { createLspSymbolsTool } from "./lsp-symbols-tool.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";
import type { SubagentWorktreeOperationCoordinator } from "./subagent-worktree-verification.js";

export const SUBAGENT_SEMANTIC_LSP_TOOL_NAMES = [
  "lsp_symbols",
  "lsp_definition",
  "lsp_references",
  "lsp_rename",
  "lsp_rename_apply",
  "lsp_code_actions",
  "lsp_code_action_apply",
] as const;

export type SubagentSemanticLspToolName =
  (typeof SUBAGENT_SEMANTIC_LSP_TOOL_NAMES)[number];

export function isSubagentSemanticLspToolName(
  value: string,
): value is SubagentSemanticLspToolName {
  return (SUBAGENT_SEMANTIC_LSP_TOOL_NAMES as readonly string[]).includes(
    value,
  );
}

export function createSubagentWorktreeLspTools(options: {
  session: SubagentWorktreeSession;
  dataRoot: string;
  sandbox: OsSandboxAdapter;
  enabledTools: readonly string[];
  operations: SubagentWorktreeOperationCoordinator;
  runtimeReadPaths?: string[];
  verifyToolchain?: () => Promise<void>;
}): AgentTool[] {
  const enabled = new Set(options.enabledTools);
  const lspOptions = {
    workspaceRoot: options.session.root,
    sandbox: options.sandbox,
    ...(options.runtimeReadPaths?.length
      ? { runtimeReadPaths: options.runtimeReadPaths }
      : {}),
  };
  const authorizeFiles = (files: LspRenameFile[]): boolean =>
    files.every((file) => options.session.writePaths.includes(file.path));
  const renameManager =
    enabled.has("lsp_rename") && enabled.has("lsp_rename_apply")
      ? new LspRenameMutationManager({
          workspaceRoot: options.session.root,
          dataRoot: options.dataRoot,
          diagnostics: new LspRenameApplyDiagnostics(lspOptions),
          authorizeFiles,
        })
      : undefined;
  const codeActionManager =
    enabled.has("lsp_code_actions") && enabled.has("lsp_code_action_apply")
      ? new LspCodeActionMutationManager({
          workspaceRoot: options.session.root,
          dataRoot: options.dataRoot,
          diagnostics: new LspCodeActionApplyDiagnostics(lspOptions),
          authorizeFiles,
        })
      : undefined;
  const readTools: AgentTool[] = [];
  if (enabled.has("lsp_symbols")) {
    readTools.push(createLspSymbolsTool(lspOptions));
  }
  if (enabled.has("lsp_definition")) {
    readTools.push(createLspDefinitionTool(lspOptions));
  }
  if (enabled.has("lsp_references")) {
    readTools.push(createLspReferencesTool(lspOptions));
  }
  if (enabled.has("lsp_rename")) {
    readTools.push(createLspRenameTool(lspOptions, renameManager));
  }
  if (enabled.has("lsp_code_actions")) {
    readTools.push(createLspCodeActionsTool(lspOptions, codeActionManager));
  }
  const tools = readTools.map((tool) =>
    options.operations.wrapReadOnlyTool(
      tool,
      options.session,
      options.verifyToolchain,
    ),
  );
  if (renameManager) {
    tools.splice(
      readTools.findIndex((tool) => tool.name === "lsp_rename") + 1,
      0,
      options.operations.wrapMutationTool(
        createLspRenameApplyTool(renameManager),
        options.session,
        options.verifyToolchain,
      ),
    );
  }
  if (codeActionManager) {
    tools.push(
      options.operations.wrapMutationTool(
        createLspCodeActionApplyTool(codeActionManager),
        options.session,
        options.verifyToolchain,
      ),
    );
  }
  return tools;
}
