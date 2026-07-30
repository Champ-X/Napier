import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile } from "@napier/contracts";

import { createCommandTool } from "./command-execution.js";
import { createLspCodeActionsTool } from "./lsp-code-actions-tool.js";
import { createLspDiagnosticsTool } from "./lsp-diagnostics-tool.js";
import { createLspDefinitionTool } from "./lsp-definition-tool.js";
import { LspWorkspacePatchObserver } from "./lsp-patch-diagnostics.js";
import { createLspReferencesTool } from "./lsp-references-tool.js";
import { createLspRenameTool } from "./lsp-rename-tool.js";
import { createLspSymbolsTool } from "./lsp-symbols-tool.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { LocalStore } from "./store.js";
import { createWorkspaceTools } from "./tools.js";
import { createTypescriptAstTools } from "./typescript-ast-tool.js";
import type { WorkspaceFileMutationManager } from "./workspace-file-mutations.js";
import {
  createWorkspaceFileApplyTool,
  createWorkspaceFilePreviewTool,
} from "./workspace-file-tools.js";
import { createVerificationTool } from "./verification.js";

export interface CreateStatelessAgentToolsOptions {
  store: LocalStore;
  profile: AgentProfile;
  threadId: string;
  runId: string;
  sandbox: OsSandboxAdapter;
  workspaceFileMutations?: WorkspaceFileMutationManager;
  safeReadOnlyRecovery?: boolean;
  advisorCorrection?: boolean;
}

export function createStatelessAgentTools(
  options: CreateStatelessAgentToolsOptions,
): AgentTool[] {
  if (options.advisorCorrection) return [];
  const { profile } = options;
  const processAllowed =
    !options.safeReadOnlyRecovery && profile.toolPolicy !== "observe";
  const patchObserver =
    processAllowed &&
    profile.enabledTools.includes("apply_patch") &&
    profile.enabledTools.includes("lsp_diagnostics")
      ? new LspWorkspacePatchObserver({
          workspaceRoot: options.store.workspaceRoot,
          sandbox: options.sandbox,
        })
      : undefined;
  const tools = createWorkspaceTools(options.store.workspaceRoot, {
    includeWriteTools: profile.toolPolicy !== "observe",
    dataRoot: options.store.dataRoot,
    ...(patchObserver ? { patchObserver } : {}),
  }).filter((tool) => profile.enabledTools.includes(tool.name));

  tools.push(
    ...createTypescriptAstTools(options.store.workspaceRoot).filter((tool) =>
      profile.enabledTools.includes(tool.name),
    ),
  );
  if (
    profile.enabledTools.includes("workspace_file_preview") &&
    options.workspaceFileMutations
  ) {
    tools.push(
      createWorkspaceFilePreviewTool(options.workspaceFileMutations, {
        threadId: options.threadId,
        runId: options.runId,
      }),
    );
  }
  if (
    processAllowed &&
    profile.enabledTools.includes("workspace_file_apply") &&
    options.workspaceFileMutations
  ) {
    tools.push(
      createWorkspaceFileApplyTool(options.workspaceFileMutations, {
        threadId: options.threadId,
        runId: options.runId,
      }),
    );
  }
  if (
    profile.toolPolicy !== "observe" &&
    profile.enabledTools.includes("verify_workspace")
  ) {
    tools.push(
      createVerificationTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  if (processAllowed && profile.enabledTools.includes("lsp_diagnostics")) {
    tools.push(
      createLspDiagnosticsTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  if (processAllowed && profile.enabledTools.includes("lsp_symbols")) {
    tools.push(
      createLspSymbolsTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  if (processAllowed && profile.enabledTools.includes("lsp_definition")) {
    tools.push(
      createLspDefinitionTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  if (processAllowed && profile.enabledTools.includes("lsp_references")) {
    tools.push(
      createLspReferencesTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  if (processAllowed && profile.enabledTools.includes("lsp_rename")) {
    tools.push(
      createLspRenameTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  if (processAllowed && profile.enabledTools.includes("lsp_code_actions")) {
    tools.push(
      createLspCodeActionsTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  if (processAllowed && profile.enabledTools.includes("run_command")) {
    tools.push(
      createCommandTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  return tools;
}
