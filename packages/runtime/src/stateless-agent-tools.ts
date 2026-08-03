import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { AgentProfile } from "@napier/contracts";

import { createCommandTool } from "./command-tool.js";
import { createDataFrameTool } from "./data-frame-tool.js";
import {
  createGitBranchApplyTool,
  createGitBranchPreviewTool,
} from "./git-branch-tool.js";
import { gitBranchMutationManagerFor } from "./git-branch.js";
import {
  createGitBranchSwitchApplyTool,
  createGitBranchSwitchPreviewTool,
} from "./git-branch-switch-tool.js";
import { gitBranchSwitchMutationManagerFor } from "./git-branch-switch.js";
import { createGitInspectTool } from "./git-inspect-tool.js";
import {
  createGitCommitApplyTool,
  createGitCommitPreviewTool,
} from "./git-commit-tool.js";
import { gitCommitMutationManagerFor } from "./git-commit.js";
import {
  createGitStageApplyTool,
  createGitStagePreviewTool,
} from "./git-stage-tool.js";
import type { GitStageMutationManager } from "./git-stage.js";
import {
  createGitReviewApplyTool,
  createGitReviewPreviewTool,
} from "./git-review-tool.js";
import { gitReviewMutationManagerFor } from "./git-review.js";
import { LspCodeActionApplyDiagnostics } from "./lsp-code-action-apply-diagnostics.js";
import { createLspCodeActionApplyTool } from "./lsp-code-action-apply-tool.js";
import { LspCodeActionMutationManager } from "./lsp-code-action-mutation-manager.js";
import { createLspCodeActionsTool } from "./lsp-code-actions-tool.js";
import { createLspDiagnosticsTool } from "./lsp-diagnostics-tool.js";
import { createLspDefinitionTool } from "./lsp-definition-tool.js";
import { LspWorkspacePatchObserver } from "./lsp-patch-diagnostics.js";
import type { LspProtocolExecutor } from "./lsp-protocol-session.js";
import { createLspReferencesTool } from "./lsp-references-tool.js";
import { LspRenameApplyDiagnostics } from "./lsp-rename-apply-diagnostics.js";
import { createLspRenameApplyTool } from "./lsp-rename-apply-tool.js";
import { LspRenameMutationManager } from "./lsp-rename-mutation-manager.js";
import { createLspRenameTool } from "./lsp-rename-tool.js";
import { createLspSymbolsTool } from "./lsp-symbols-tool.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import { createSqliteQueryTool } from "./sqlite-query-tool.js";
import type { LocalStore } from "./store.js";
import { createWorkspaceTools } from "./tools.js";
import { createTypescriptAstTools } from "./typescript-ast-tool.js";
import type { WorkspaceFileMutationManager } from "./workspace-file-mutations.js";
import {
  createWorkspaceFileApplyTool,
  createWorkspaceFilePreviewTool,
} from "./workspace-file-tools.js";
import { createVerificationTool } from "./verification.js";
import { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";
import { WriteLinkedWorkspacePatchObserver } from "./write-linked-workspace-patch.js";

export interface CreateStatelessAgentToolsOptions {
  store: LocalStore;
  profile: AgentProfile;
  threadId: string;
  runId: string;
  sandbox: OsSandboxAdapter;
  lspSession?: LspProtocolExecutor;
  workspaceFileMutations?: WorkspaceFileMutationManager;
  gitStageMutations?: GitStageMutationManager;
  gitStageScopeId?: string;
  gitCommitScopeId?: string;
  gitBranchScopeId?: string;
  gitBranchSwitchScopeId?: string;
  gitReviewScopeId?: string;
  restrictedReadOnlyExecution?: boolean;
  advisorCorrection?: boolean;
}

export function createStatelessAgentTools(
  options: CreateStatelessAgentToolsOptions,
): AgentTool[] {
  if (options.advisorCorrection) return [];
  const { profile } = options;
  const processAllowed =
    !options.restrictedReadOnlyExecution && profile.toolPolicy !== "observe";
  const lspOptions = {
    workspaceRoot: options.store.workspaceRoot,
    sandbox: options.sandbox,
    ...(options.lspSession ? { session: options.lspSession } : {}),
  };
  const lspPatchObserver =
    processAllowed &&
    profile.enabledTools.includes("apply_patch") &&
    profile.enabledTools.includes("lsp_diagnostics")
      ? new LspWorkspacePatchObserver(lspOptions)
      : undefined;
  const writeLinkedTests =
    processAllowed &&
    profile.enabledTools.includes("apply_patch") &&
    profile.enabledTools.includes("verify_workspace")
      ? new WriteLinkedTestVerificationRunner({
          workspaceRoot: options.store.workspaceRoot,
          sandbox: options.sandbox,
        })
      : undefined;
  const patchObserver =
    lspPatchObserver || writeLinkedTests
      ? new WriteLinkedWorkspacePatchObserver({
          ...(lspPatchObserver ? { diagnostics: lspPatchObserver } : {}),
          ...(writeLinkedTests ? { tests: writeLinkedTests } : {}),
        })
      : undefined;
  const coordinatedLspWriteTests =
    processAllowed &&
    profile.enabledTools.includes("verify_workspace") &&
    (profile.enabledTools.includes("lsp_rename_apply") ||
      profile.enabledTools.includes("lsp_code_action_apply"))
      ? new WriteLinkedTestVerificationRunner({
          workspaceRoot: options.store.workspaceRoot,
          sandbox: options.sandbox,
        })
      : undefined;
  const renameMutationManager =
    processAllowed &&
    profile.enabledTools.includes("lsp_rename") &&
    profile.enabledTools.includes("lsp_rename_apply")
      ? new LspRenameMutationManager({
          workspaceRoot: options.store.workspaceRoot,
          dataRoot: options.store.dataRoot,
          diagnostics: new LspRenameApplyDiagnostics(lspOptions),
          ...(coordinatedLspWriteTests
            ? { tests: coordinatedLspWriteTests }
            : {}),
        })
      : undefined;
  const codeActionMutationManager =
    processAllowed &&
    profile.enabledTools.includes("lsp_code_actions") &&
    profile.enabledTools.includes("lsp_code_action_apply")
      ? new LspCodeActionMutationManager({
          workspaceRoot: options.store.workspaceRoot,
          dataRoot: options.store.dataRoot,
          diagnostics: new LspCodeActionApplyDiagnostics(lspOptions),
          ...(coordinatedLspWriteTests
            ? { tests: coordinatedLspWriteTests }
            : {}),
        })
      : undefined;
  const tools = createWorkspaceTools(options.store.workspaceRoot, {
    includeWriteTools: processAllowed,
    dataRoot: options.store.dataRoot,
    ...(patchObserver ? { patchObserver } : {}),
  }).filter((tool) => profile.enabledTools.includes(tool.name));
  appendDataTools(tools, profile, options.store.workspaceRoot);

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
  appendGitStageTools(tools, options, processAllowed);
  appendGitCommitTools(tools, options, processAllowed);
  appendGitBranchTools(tools, options, processAllowed);
  appendGitBranchSwitchTools(tools, options, processAllowed);
  appendGitReviewTools(tools, options, processAllowed);
  if (processAllowed && profile.enabledTools.includes("verify_workspace")) {
    tools.push(
      createVerificationTool({
        workspaceRoot: options.store.workspaceRoot,
        sandbox: options.sandbox,
      }),
    );
  }
  if (processAllowed && profile.enabledTools.includes("lsp_diagnostics")) {
    tools.push(createLspDiagnosticsTool(lspOptions));
  }
  if (processAllowed && profile.enabledTools.includes("lsp_symbols")) {
    tools.push(createLspSymbolsTool(lspOptions));
  }
  if (processAllowed && profile.enabledTools.includes("lsp_definition")) {
    tools.push(createLspDefinitionTool(lspOptions));
  }
  if (processAllowed && profile.enabledTools.includes("lsp_references")) {
    tools.push(createLspReferencesTool(lspOptions));
  }
  if (processAllowed && profile.enabledTools.includes("lsp_rename")) {
    tools.push(createLspRenameTool(lspOptions, renameMutationManager));
  }
  if (
    processAllowed &&
    profile.enabledTools.includes("lsp_rename_apply") &&
    renameMutationManager
  ) {
    tools.push(createLspRenameApplyTool(renameMutationManager));
  }
  if (processAllowed && profile.enabledTools.includes("lsp_code_actions")) {
    tools.push(createLspCodeActionsTool(lspOptions, codeActionMutationManager));
  }
  if (
    processAllowed &&
    profile.enabledTools.includes("lsp_code_action_apply") &&
    codeActionMutationManager
  ) {
    tools.push(createLspCodeActionApplyTool(codeActionMutationManager));
  }
  appendProcessReadTools(tools, options, processAllowed);
  return tools;
}

function appendProcessReadTools(
  tools: AgentTool[],
  options: CreateStatelessAgentToolsOptions,
  processAllowed: boolean,
): void {
  if (!processAllowed) return;
  const runnerOptions = {
    workspaceRoot: options.store.workspaceRoot,
    sandbox: options.sandbox,
  };
  if (options.profile.enabledTools.includes("run_command")) {
    tools.push(createCommandTool(runnerOptions));
  }
  if (options.profile.enabledTools.includes("git_inspect")) {
    tools.push(createGitInspectTool(runnerOptions));
  }
}

function appendGitStageTools(
  tools: AgentTool[],
  options: CreateStatelessAgentToolsOptions,
  processAllowed: boolean,
): void {
  if (!processAllowed || !options.gitStageMutations) return;
  const context = {
    threadId: options.threadId,
    scopeId: options.gitStageScopeId ?? options.runId,
  };
  if (options.profile.enabledTools.includes("git_stage_preview")) {
    tools.push(createGitStagePreviewTool(options.gitStageMutations, context));
  }
  if (options.profile.enabledTools.includes("git_stage_apply")) {
    tools.push(createGitStageApplyTool(options.gitStageMutations, context));
  }
}

function appendGitCommitTools(
  tools: AgentTool[],
  options: CreateStatelessAgentToolsOptions,
  processAllowed: boolean,
): void {
  if (!processAllowed) return;
  const manager = gitCommitMutationManagerFor(options.store, options.sandbox);
  const context = {
    threadId: options.threadId,
    scopeId: options.gitCommitScopeId ?? options.runId,
  };
  if (options.profile.enabledTools.includes("git_commit_preview")) {
    tools.push(createGitCommitPreviewTool(manager, context));
  }
  if (options.profile.enabledTools.includes("git_commit_apply")) {
    tools.push(createGitCommitApplyTool(manager, context));
  }
}

function appendGitBranchTools(
  tools: AgentTool[],
  options: CreateStatelessAgentToolsOptions,
  processAllowed: boolean,
): void {
  if (!processAllowed) return;
  const manager = gitBranchMutationManagerFor(options.store, options.sandbox);
  const context = {
    threadId: options.threadId,
    scopeId: options.gitBranchScopeId ?? options.runId,
  };
  if (options.profile.enabledTools.includes("git_branch_create_preview")) {
    tools.push(createGitBranchPreviewTool(manager, context));
  }
  if (options.profile.enabledTools.includes("git_branch_create_apply")) {
    tools.push(createGitBranchApplyTool(manager, context));
  }
}

function appendGitBranchSwitchTools(
  tools: AgentTool[],
  options: CreateStatelessAgentToolsOptions,
  processAllowed: boolean,
): void {
  if (!processAllowed) return;
  const manager = gitBranchSwitchMutationManagerFor(
    options.store,
    options.sandbox,
  );
  const context = {
    threadId: options.threadId,
    scopeId: options.gitBranchSwitchScopeId ?? options.runId,
  };
  if (options.profile.enabledTools.includes("git_branch_switch_preview")) {
    tools.push(createGitBranchSwitchPreviewTool(manager, context));
  }
  if (options.profile.enabledTools.includes("git_branch_switch_apply")) {
    tools.push(createGitBranchSwitchApplyTool(manager, context));
  }
}

function appendGitReviewTools(
  tools: AgentTool[],
  options: CreateStatelessAgentToolsOptions,
  processAllowed: boolean,
): void {
  if (!processAllowed) return;
  const manager = gitReviewMutationManagerFor(options.store, options.sandbox);
  const context = {
    threadId: options.threadId,
    scopeId: options.gitReviewScopeId ?? options.runId,
  };
  if (options.profile.enabledTools.includes("git_review_preview")) {
    tools.push(createGitReviewPreviewTool(manager, context));
  }
  if (options.profile.enabledTools.includes("git_review_apply")) {
    tools.push(createGitReviewApplyTool(manager, context));
  }
}

function appendDataTools(
  tools: AgentTool[],
  profile: AgentProfile,
  workspaceRoot: string,
): void {
  if (profile.enabledTools.includes("sqlite_query")) {
    tools.push(createSqliteQueryTool(workspaceRoot));
  }
  if (profile.enabledTools.includes("data_frame")) {
    tools.push(createDataFrameTool(workspaceRoot));
  }
}
