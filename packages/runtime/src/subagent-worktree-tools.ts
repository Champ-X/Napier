import type { AgentTool } from "@earendil-works/pi-agent-core";

import { createCommandTool } from "./command-tool.js";
import { createLspDiagnosticsTool } from "./lsp-diagnostics-tool.js";
import { createNodeDebuggerTool } from "./node-debugger-tool.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import type { SubagentWorktreeDebugger } from "./subagent-worktree-debugger.js";
import { createSubagentWorktreeFileTool } from "./subagent-worktree-file-tool.js";
import type { SubagentWorktreeSession } from "./subagent-worktree-files.js";
import { createSubagentWorktreeLspTools } from "./subagent-worktree-lsp-tools.js";
import { createSubagentWorktreePatchTool } from "./subagent-worktree-patch-tool.js";
import {
  assertSubagentWorktreeToolchainStable,
  type SubagentWorktreeToolchain,
} from "./subagent-worktree-toolchain.js";
import type { SubagentWorktreeOperationCoordinator } from "./subagent-worktree-verification.js";
import { createTypescriptAstTools } from "./typescript-ast-tool.js";
import { createWorkspaceTools } from "./tools.js";
import { createVerificationTool } from "./verification.js";

export function createSubagentWorktreeTools(options: {
  session: SubagentWorktreeSession;
  dataRoot: string;
  operations: SubagentWorktreeOperationCoordinator;
  toolchain?: SubagentWorktreeToolchain;
  sandbox?: OsSandboxAdapter;
  debugger?: SubagentWorktreeDebugger;
  enableCandidateCommand?: boolean;
  enableCandidateVerification?: boolean;
  enabledSemanticLspTools?: readonly string[];
}): AgentTool[] {
  const tools = [
    ...createWorkspaceTools(options.session.root),
    ...createTypescriptAstTools(options.session.root),
    createSubagentWorktreePatchTool(
      options.session,
      options.dataRoot,
      options.operations.runMutation.bind(options.operations),
    ),
    createSubagentWorktreeFileTool(
      options.session,
      options.operations.runMutation.bind(options.operations),
    ),
  ];
  if (!options.sandbox) return tools;
  const verifyToolchain = options.toolchain
    ? () => assertSubagentWorktreeToolchainStable(options.toolchain!)
    : undefined;
  const runtimeReadPaths = options.toolchain
    ? [options.toolchain.sourceNodeModulesRoot]
    : [];
  tools.push(
    ...createSubagentWorktreeLspTools({
      session: options.session,
      dataRoot: options.dataRoot,
      sandbox: options.sandbox,
      enabledTools: options.enabledSemanticLspTools ?? [],
      operations: options.operations,
      ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
      ...(verifyToolchain ? { verifyToolchain } : {}),
    }),
  );
  if (options.debugger) {
    tools.push(
      options.operations.wrapReadOnlyTool(
        createNodeDebuggerTool(
          options.debugger.manager,
          options.debugger.owner,
        ),
        options.session,
        verifyToolchain,
      ),
    );
  }
  if (options.enableCandidateCommand) {
    tools.push(
      options.operations.wrapCommandTool(
        createCommandTool({
          workspaceRoot: options.session.root,
          sandbox: options.sandbox,
          ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
        }),
        options.session,
        verifyToolchain,
      ),
    );
  }
  tools.push(
    options.operations.wrapVerificationTool(
      createLspDiagnosticsTool({
        workspaceRoot: options.session.root,
        sandbox: options.sandbox,
        ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
      }),
      options.session,
      verifyToolchain,
    ),
  );
  if (options.enableCandidateVerification && options.toolchain) {
    tools.push(
      options.operations.wrapVerificationTool(
        createVerificationTool({
          workspaceRoot: options.session.root,
          toolchainRoot: options.session.sourceRoot,
          sandbox: options.sandbox,
        }),
        options.session,
        verifyToolchain,
      ),
    );
  }
  return tools;
}
