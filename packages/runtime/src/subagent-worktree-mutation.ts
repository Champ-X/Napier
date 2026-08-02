import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { LspRenameApplyDiagnosticsDetails } from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
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
  observeSubagentWorktreeSource,
  removeSubagentWorktree,
  type SubagentWorktreeSession,
} from "./subagent-worktree-files.js";
import { subagentWorktreeModifiedLspFiles } from "./subagent-worktree-diff.js";
import {
  SubagentWorktreeLifecycleDiagnostics,
  type SubagentWorktreeLifecycleDiagnosticsAdapter,
} from "./subagent-worktree-lifecycle-diagnostics.js";
import { createSubagentWorktreeReview } from "./subagent-worktree-review.js";
import {
  assertSubagentWorktreeToolchainStable,
  prepareSubagentWorktreeToolchain,
  type SubagentWorktreeToolchain,
} from "./subagent-worktree-toolchain.js";
import { createSubagentWorktreeTools } from "./subagent-worktree-tools.js";
import {
  type SubagentCandidateCommandSummary,
  type SubagentCandidateVerificationSummary,
  SubagentWorktreeOperationCoordinator,
} from "./subagent-worktree-verification.js";
import type {
  SubagentWorktreeApplyResult,
  WorktreePreviewSource,
} from "./subagent-worktree-mutation-model.js";
import {
  commitWorkspaceChanges,
  type CommitWorkspaceChangesOptions,
} from "./workspace-change-commit.js";
import type { WorkspaceProcessManager } from "./workspace-processes.js";
import type { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";

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

export interface SubagentWorktreePreview {
  id: string;
  expiresAt: string;
  taskId: string;
  changedPaths: string[];
  changedFileCount: number;
  changedFileSetSha256: string;
  addedFileCount: number;
  modifiedFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  sourceSnapshotSha256: string;
  review: string;
  reviewTruncated: boolean;
  candidateVerification: SubagentCandidateVerificationSummary;
  candidateCommands: SubagentCandidateCommandSummary;
  candidateToolchainSha256?: string;
}

export interface SubagentWorktreeMutationManagerOptions {
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
      preflight: (source, signal) =>
        observeSubagentWorktreeSource(source, signal),
      changeCount: (source) => source.changes.length,
      commitSource: (source, signal) =>
        commitSubagentWorktreeChanges({
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
        }),
      ...(!sourceVerification && options.tests ? { tests: options.tests } : {}),
      ...(options.now ? { now: options.now } : {}),
    });
  }

  async createWorktree(
    taskId: string,
    writePaths: string[],
    signal?: AbortSignal,
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
      const candidateDebugger =
        this.options.enableCandidateDebugger &&
        this.options.processes &&
        this.options.debuggerOwner
          ? createSubagentWorktreeDebugger({
              processes: this.options.processes,
              session,
              owner: this.options.debuggerOwner,
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
  ): Promise<SubagentWorktreePreview> {
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
    const review = createSubagentWorktreeReview(candidate.changes);
    const modifiedFiles = subagentWorktreeModifiedLspFiles(candidate.changes);
    const candidateVerification = context.operations.summarize(
      candidate.candidateSnapshotSha256,
    );
    const candidateCommands = context.operations.summarizeCommands(
      candidate.candidateSnapshotSha256,
    );
    const receipt = {
      taskId: session.taskId,
      outcomeSha256,
      sourceSnapshotSha256: session.sourceSnapshotSha256,
      sourceFileCount: session.sourceFileCount,
      sourceBytes: session.sourceBytes,
      writeScopeCount: session.writePaths.length,
      writeScopeSetSha256: session.writeScopeSetSha256,
      changedFileCount: candidate.changes.length,
      changedFileSetSha256: candidate.changedFileSetSha256,
      addedFileCount: candidate.addedFileCount,
      modifiedFileCount: candidate.modifiedFileCount,
      deletedFileCount: candidate.deletedFileCount,
      renamedFileCount: candidate.renamedFileCount,
      candidateVerificationAttemptCount: candidateVerification.attemptCount,
      candidateVerificationFreshCount: candidateVerification.freshCount,
      candidateVerificationPassedCount: candidateVerification.passedCount,
      candidateVerificationFailedCount: candidateVerification.failedCount,
      candidateVerificationStaleCount: candidateVerification.staleCount,
      candidateVerificationSetSha256: candidateVerification.setSha256,
      candidateCommandAttemptCount: candidateCommands.attemptCount,
      candidateCommandFreshCount: candidateCommands.freshCount,
      candidateCommandSucceededCount: candidateCommands.succeededCount,
      candidateCommandFailedCount: candidateCommands.failedCount,
      candidateCommandStaleCount: candidateCommands.staleCount,
      candidateCommandSetSha256: candidateCommands.setSha256,
      ...(context.toolchain
        ? { candidateToolchainSha256: context.toolchain.contentSha256 }
        : {}),
    };
    await removeSubagentWorktree(session.root);
    this.contexts.delete(session);
    const stored = this.coordinator.storePreview({
      sourcePreviewResultSha256: sha256(canonicalJson(receipt)),
      taskId: session.taskId,
      outcomeSha256,
      sourceRoot: session.sourceRoot,
      sourceSnapshotSha256: session.sourceSnapshotSha256,
      sourceFileCount: session.sourceFileCount,
      sourceBytes: session.sourceBytes,
      writeScopeCount: session.writePaths.length,
      writeScopeSetSha256: session.writeScopeSetSha256,
      changedFileSetSha256: candidate.changedFileSetSha256,
      addedFileCount: candidate.addedFileCount,
      modifiedFileCount: candidate.modifiedFileCount,
      deletedFileCount: candidate.deletedFileCount,
      renamedFileCount: candidate.renamedFileCount,
      candidateVerificationAttemptCount: candidateVerification.attemptCount,
      candidateVerificationFreshCount: candidateVerification.freshCount,
      candidateVerificationPassedCount: candidateVerification.passedCount,
      candidateVerificationFailedCount: candidateVerification.failedCount,
      candidateVerificationStaleCount: candidateVerification.staleCount,
      candidateVerificationSetSha256: candidateVerification.setSha256,
      candidateCommandAttemptCount: candidateCommands.attemptCount,
      candidateCommandFreshCount: candidateCommands.freshCount,
      candidateCommandSucceededCount: candidateCommands.succeededCount,
      candidateCommandFailedCount: candidateCommands.failedCount,
      candidateCommandStaleCount: candidateCommands.staleCount,
      candidateCommandSetSha256: candidateCommands.setSha256,
      ...(context.toolchain
        ? { candidateToolchainSha256: context.toolchain.contentSha256 }
        : {}),
      changes: candidate.changes,
      files: modifiedFiles,
    });
    if (!stored) {
      throw new Error("Subagent worktree merge preview could not be stored");
    }
    return {
      id: stored.id,
      expiresAt: stored.expiresAt,
      taskId: session.taskId,
      changedPaths: candidate.changedPaths,
      changedFileCount: candidate.changes.length,
      changedFileSetSha256: candidate.changedFileSetSha256,
      addedFileCount: candidate.addedFileCount,
      modifiedFileCount: candidate.modifiedFileCount,
      deletedFileCount: candidate.deletedFileCount,
      renamedFileCount: candidate.renamedFileCount,
      sourceSnapshotSha256: session.sourceSnapshotSha256,
      review: review.text,
      reviewTruncated: review.truncated,
      candidateVerification,
      candidateCommands,
      ...(context.toolchain
        ? { candidateToolchainSha256: context.toolchain.contentSha256 }
        : {}),
    };
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

  async apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeApplyResult> {
    const execution = await this.coordinator.apply(previewId, signal);
    return createSubagentWorktreeApplyResult(execution);
  }
}

export type SubagentWorktreeDiagnosticsDetails =
  LspRenameApplyDiagnosticsDetails;
