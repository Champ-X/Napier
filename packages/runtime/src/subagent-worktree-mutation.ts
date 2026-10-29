import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { LspRenameApplyDiagnosticsDetails } from "@napier/contracts";

import type {
  LspRenameDiagnosticsObservation,
  LspRenameDiagnosticsState,
} from "./lsp-rename-apply-diagnostics.js";
import {
  LspWorkspaceEditMutationCoordinator,
  type LspWorkspaceEditDiagnosticsAdapter,
} from "./lsp-workspace-edit-mutation.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import { createSubagentWorktreeApplyResult } from "./subagent-worktree-apply-result.js";
import {
  createSubagentWorktreeApplyVerification,
  type SubagentWorktreeApplyVerificationState,
} from "./subagent-worktree-apply-verification.js";
import { commitSubagentWorktreeChanges } from "./subagent-worktree-commit.js";
import {
  createSubagentWorktreeDebugger,
  settleSubagentWorktreeDebugger,
  type SubagentWorktreeDebugger,
  type SubagentWorktreeDebuggerOwner,
} from "./subagent-worktree-debugger.js";
import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
  removeSubagentWorktree,
  type SubagentWorktreeSession,
} from "./subagent-worktree-files.js";
import {
  SubagentWorktreeLifecycleDiagnostics,
  type SubagentWorktreeLifecycleDiagnosticsAdapter,
} from "./subagent-worktree-lifecycle-diagnostics.js";
import {
  assertSubagentWorktreeToolchainStable,
  prepareSubagentWorktreeToolchain,
  type SubagentWorktreeToolchain,
} from "./subagent-worktree-toolchain.js";
import { createSubagentWorktreeTools } from "./subagent-worktree-tools.js";
import { SubagentWorktreeOperationCoordinator } from "./subagent-worktree-verification.js";
import type {
  PreparedSubagentCompletion,
  SubagentCandidateDeliveryAuthority,
  SubagentWorktreeApplyResult,
  SubagentWorktreePreview,
  WorktreePreviewSource,
} from "./subagent-worktree-mutation-model.js";
import {
  commitWorkspaceChanges,
  type CommitWorkspaceChangesOptions,
} from "./workspace-change-commit.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";
import type { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";
import { rethrowAfterCandidateRevocation, SubagentWorktreeDelivery } from "./subagent-worktree-delivery.js";

export {
  createSubagentWorktreeApplyTool,
  subagentWorktreeToolCallArgumentsLedgerProjection,
  subagentWorktreeToolInputLedgerProjection,
  subagentWorktreeToolOutputLedgerProjection,
} from "./subagent-worktree-tool.js";
export type {
  SubagentWorktreeApplyResult,
  WorktreePreviewSource,
} from "./subagent-worktree-mutation-model.js";

export type { SubagentWorktreePreview } from "./subagent-worktree-mutation-model.js";

export interface SubagentWorktreeMutationManagerOptions {
  candidateDeliveryAuthority?: SubagentCandidateDeliveryAuthority;
  requireCompletionBinding?: boolean;
  workspaceRoot: string;
  dataRoot: string;
  ownerId: string;
  sandbox?: OsSandboxAdapter;
  processes?: WorkspaceProcessManager;
  debuggerOwner?: SubagentWorktreeDebuggerOwner;
  enableCandidateDebugger?: boolean;
  enableCandidateVerification?: boolean;
  enableCandidateCommand?: boolean;
  enabledSemanticLspTools?: readonly string[];
  diagnostics?: LspWorkspaceEditDiagnosticsAdapter<
    LspRenameDiagnosticsState,
    LspRenameDiagnosticsObservation
  >;
  lifecycleDiagnostics?: SubagentWorktreeLifecycleDiagnosticsAdapter;
  tests?: Pick<
    WriteLinkedTestVerificationRunner,
    | "captureBefore"
    | "run"
    | "supports"
    | "captureLifecycleBefore"
    | "runLifecycle"
  >;
  now?: () => Date;
  commitChanges?: typeof commitWorkspaceChanges;
  commitOptions?: Pick<
    CommitWorkspaceChangesOptions,
    "renameFile" | "linkFile" | "unlinkFile"
  >;
}

interface SubagentWorktreeContext {
  operations: SubagentWorktreeOperationCoordinator;
  toolchain?: SubagentWorktreeToolchain;
  debugger?: SubagentWorktreeDebugger;
}

export class SubagentWorktreeMutationManager {
  private readonly candidates: SubagentWorktreeDelivery;
  private readonly contexts = new WeakMap<
    SubagentWorktreeSession,
    SubagentWorktreeContext
  >();
  private readonly coordinator: LspWorkspaceEditMutationCoordinator<
    WorktreePreviewSource,
    LspRenameDiagnosticsState,
    LspRenameDiagnosticsObservation,
    SubagentWorktreeApplyVerificationState
  >;

  constructor(
    private readonly options: SubagentWorktreeMutationManagerOptions,
  ) {
    this.candidates = new SubagentWorktreeDelivery(options);
    const lifecycleDiagnostics =
      options.lifecycleDiagnostics ??
      (options.sandbox
        ? new SubagentWorktreeLifecycleDiagnostics({
            workspaceRoot: options.workspaceRoot,
            sandbox: options.sandbox,
          })
        : undefined);
    const sourceVerification = lifecycleDiagnostics
      ? createSubagentWorktreeApplyVerification<WorktreePreviewSource>({
          diagnostics: lifecycleDiagnostics,
          ...(options.tests ? { tests: options.tests } : {}),
        })
      : undefined;
    if (!sourceVerification && !options.diagnostics) {
      throw new Error("Subagent worktree merge diagnostics are required");
    }
    this.coordinator = new LspWorkspaceEditMutationCoordinator({
      workspaceRoot: options.workspaceRoot,
      dataRoot: options.dataRoot,
      label: "Subagent worktree apply",
      previewPrefix: "subworkpreview",
      ...(sourceVerification
        ? { sourceVerification }
        : { diagnostics: options.diagnostics! }),
      preflight: (source, signal) => this.candidates.prepare(source, signal),
      changeCount: (source) => source.changes.length,
      commitSource: async (source, signal) => {
        await this.candidates.beginCommit(source);
        return commitSubagentWorktreeChanges({
          workspaceRoot: options.workspaceRoot,
          dataRoot: options.dataRoot,
          source,
          ...(signal ? { signal } : {}),
          ...(options.commitChanges
            ? { commitChanges: options.commitChanges }
            : {}),
          ...(options.commitOptions
            ? { commitOptions: options.commitOptions }
            : {}),
        });
      },
      ...(!sourceVerification && options.tests ? { tests: options.tests } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  async createWorktree(
    taskId: string,
    writePaths: string[],
    signal?: AbortSignal,
    executionOwner?: SubagentWorktreeDebuggerOwner,
  ): Promise<SubagentWorktreeSession> {
    const session = await createSubagentWorktree({
      workspaceRoot: this.options.workspaceRoot,
      dataRoot: this.options.dataRoot,
      ownerId: this.options.ownerId,
      taskId,
      writePaths,
      ...(signal ? { signal } : {}),
    });
    try {
      const toolchain = await prepareSubagentWorktreeToolchain({
        sourceRoot: session.sourceRoot,
        candidateRoot: session.root,
        ...(signal ? { signal } : {}),
      });
      const debuggerOwner = executionOwner ?? this.options.debuggerOwner;
      const candidateDebugger =
        this.options.enableCandidateDebugger &&
        this.options.processes &&
        debuggerOwner
          ? createSubagentWorktreeDebugger({
              processes: this.options.processes,
              session,
              owner: debuggerOwner,
              ...(toolchain ? { toolchain } : {}),
            })
          : undefined;
      this.contexts.set(session, {
        operations: new SubagentWorktreeOperationCoordinator(),
        ...(toolchain ? { toolchain } : {}),
        ...(candidateDebugger ? { debugger: candidateDebugger } : {}),
      });
      return session;
    } catch (error) {
      await removeSubagentWorktree(session.root);
      throw error;
    }
  }

  createCoderTools(session: SubagentWorktreeSession): AgentTool[] {
    const context = this.contexts.get(session);
    if (!context) {
      throw new Error("Coder Subagent worktree context is unavailable");
    }
    return createSubagentWorktreeTools({
      session,
      dataRoot: this.options.dataRoot,
      operations: context.operations,
      ...(context.toolchain ? { toolchain: context.toolchain } : {}),
      ...(this.options.sandbox ? { sandbox: this.options.sandbox } : {}),
      ...(context.debugger ? { debugger: context.debugger } : {}),
      ...(this.options.enableCandidateCommand
        ? { enableCandidateCommand: true }
        : {}),
      ...(this.options.enableCandidateVerification
        ? { enableCandidateVerification: true }
        : {}),
      ...(this.options.enabledSemanticLspTools
        ? { enabledSemanticLspTools: this.options.enabledSemanticLspTools }
        : {}),
    });
  }

  async storePreview(
    session: SubagentWorktreeSession,
    outcomeSha256: string,
    signal?: AbortSignal,
    prepared?: PreparedSubagentCompletion,
  ): Promise<SubagentWorktreePreview> {
    if (this.options.requireCompletionBinding && !prepared)
      throw new Error("Coder candidate requires durable completion preparation");
    signal?.throwIfAborted();
    if (!/^[a-f0-9]{64}$/u.test(outcomeSha256)) {
      throw new Error("Subagent worktree outcome hash is invalid");
    }
    const context = this.contexts.get(session);
    if (!context) {
      throw new Error("Coder Subagent worktree context is unavailable");
    }
    await context.operations.settle();
    if (context.debugger) {
      await settleSubagentWorktreeDebugger({
        debugger: context.debugger,
        operations: context.operations,
        session,
      });
    }
    context.operations.assertIntegrity();
    if (context.toolchain) {
      await assertSubagentWorktreeToolchainStable(context.toolchain);
    }
    const candidate = await finalizeSubagentWorktree(session, signal);
    const candidateVerification = context.operations.summarize(
      candidate.candidateSnapshotSha256,
    );
    const candidateCommands = context.operations.summarizeCommands(
      candidate.candidateSnapshotSha256,
    );
    const preview = await this.candidates.deliver(
      session,
      outcomeSha256,
      candidate,
      candidateVerification,
      candidateCommands,
      context.toolchain,
      signal,
      prepared,
    );
    try {
      signal?.throwIfAborted();
      await removeSubagentWorktree(session.root);
      this.contexts.delete(session);
      signal?.throwIfAborted();
      return preview;
    } catch (error) {
      if (preview.cleanupOwned === false) throw error;
      return rethrowAfterCandidateRevocation(error, () =>
        this.revokePreview(preview.id, session.taskId),
      );
    }
  }

  async cleanup(session: SubagentWorktreeSession): Promise<void> {
    const context = this.contexts.get(session);
    try {
      if (context?.debugger) {
        await context.operations.settle();
        await settleSubagentWorktreeDebugger({
          debugger: context.debugger,
          operations: context.operations,
          session,
        });
      }
    } finally {
      this.contexts.delete(session);
      await removeSubagentWorktree(session.root);
    }
  }

  inspectPreview(previewId: string) {
    return this.candidates.inspect(previewId);
  }

  revokePreview(previewId: string, taskId: string): Promise<boolean> {
    return this.candidates.revokeUndelivered(previewId, taskId);
  }

  prunePreviews(previewIds: string[]): Promise<number> {
    return this.candidates.prune(previewIds);
  }

  async apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeApplyResult> {
    return this.candidates.apply(previewId, async (source) => {
      const transient = this.coordinator.storePreview(source);
      if (!transient) throw new Error("Subagent candidate has no changes");
      const execution = await this.coordinator.apply(transient.id, signal);
      return createSubagentWorktreeApplyResult(execution);
    });
  }
}

export type SubagentWorktreeDiagnosticsDetails =
  LspRenameApplyDiagnosticsDetails;
