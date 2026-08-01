import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  LspRenameApplyDiagnosticsDetails,
  SubagentWorktreeApplyDetails,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  LspRenameDiagnosticsObservation,
  LspRenameDiagnosticsState,
} from "./lsp-rename-apply-diagnostics.js";
import { createLspDiagnosticsTool } from "./lsp-diagnostics-tool.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import {
  formatLspWorkspaceEditApplySummary,
  LspWorkspaceEditMutationCoordinator,
  type LspWorkspaceEditDiagnosticsAdapter,
  type LspWorkspaceEditPreviewSource,
} from "./lsp-workspace-edit-mutation.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import {
  createSubagentWorktreeApplyVerification,
  type SubagentWorktreeApplyVerificationState,
} from "./subagent-worktree-apply-verification.js";
import { commitSubagentWorktreeChanges } from "./subagent-worktree-commit.js";
import { createSubagentWorktreeFileTool } from "./subagent-worktree-file-tool.js";
import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
  observeSubagentWorktreeSource,
  removeSubagentWorktree,
  type SubagentWorktreeSession,
} from "./subagent-worktree-files.js";
import {
  subagentWorktreeModifiedLspFiles,
  type SubagentWorktreeChange,
} from "./subagent-worktree-diff.js";
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
import {
  type SubagentCandidateVerificationSummary,
  SubagentWorktreeOperationCoordinator,
} from "./subagent-worktree-verification.js";
import { createTypescriptAstTools } from "./typescript-ast-tool.js";
import {
  applyWorkspacePatch,
  createWorkspaceTools,
  type WorkspacePatchInput,
} from "./tools.js";
import { createWorkspacePatchTool } from "./workspace-patch-tool.js";
import { createVerificationTool } from "./verification.js";
import {
  commitWorkspaceChanges,
  type CommitWorkspaceChangesOptions,
} from "./workspace-change-commit.js";
import type { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";

export {
  createSubagentWorktreeApplyTool,
  subagentWorktreeToolCallArgumentsLedgerProjection,
  subagentWorktreeToolInputLedgerProjection,
  subagentWorktreeToolOutputLedgerProjection,
} from "./subagent-worktree-tool.js";

interface WorktreePreviewSource extends LspWorkspaceEditPreviewSource {
  taskId: string;
  outcomeSha256: string;
  sourceRoot: string;
  sourceSnapshotSha256: string;
  sourceFileCount: number;
  sourceBytes: number;
  writeScopeCount: number;
  writeScopeSetSha256: string;
  changedFileSetSha256: string;
  candidateVerificationAttemptCount: number;
  candidateVerificationFreshCount: number;
  candidateVerificationPassedCount: number;
  candidateVerificationFailedCount: number;
  candidateVerificationStaleCount: number;
  candidateVerificationSetSha256: string;
  candidateToolchainSha256?: string;
  addedFileCount: number;
  modifiedFileCount: number;
  deletedFileCount: number;
  renamedFileCount: number;
  changes: SubagentWorktreeChange[];
  files: LspRenameFile[];
}

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
  candidateToolchainSha256?: string;
}

export interface SubagentWorktreeApplyResult {
  details: SubagentWorktreeApplyDetails;
  summary: string;
}

export interface SubagentWorktreeMutationManagerOptions {
  workspaceRoot: string;
  dataRoot: string;
  ownerId: string;
  sandbox?: OsSandboxAdapter;
  enableCandidateVerification?: boolean;
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

export class SubagentWorktreeMutationManager {
  private readonly contexts = new WeakMap<
    SubagentWorktreeSession,
    {
      operations: SubagentWorktreeOperationCoordinator;
      toolchain?: SubagentWorktreeToolchain;
    }
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
      this.contexts.set(session, {
        operations: new SubagentWorktreeOperationCoordinator(),
        ...(toolchain ? { toolchain } : {}),
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
    const tools = [
      ...createWorkspaceTools(session.root),
      ...createTypescriptAstTools(session.root),
    ];
    tools.push(
      createWorkspacePatchTool({
        workspaceRoot: session.root,
        dataRoot: this.options.dataRoot,
        applyPatch: async (workspaceRoot, dataRoot, input) => {
          return context.operations.runMutation(async () => {
            assertAuthorizedPatch(session, input);
            return applyWorkspacePatch(workspaceRoot, dataRoot, input);
          });
        },
      }),
    );
    tools.push(
      createSubagentWorktreeFileTool(
        session,
        context.operations.runMutation.bind(context.operations),
      ),
    );
    if (this.options.sandbox) {
      const verifyToolchain = context.toolchain
        ? () => assertSubagentWorktreeToolchainStable(context.toolchain!)
        : undefined;
      const runtimeReadPaths = context.toolchain
        ? [context.toolchain.sourceNodeModulesRoot]
        : [];
      tools.push(
        context.operations.wrapVerificationTool(
          createLspDiagnosticsTool({
            workspaceRoot: session.root,
            sandbox: this.options.sandbox,
            ...(runtimeReadPaths.length > 0 ? { runtimeReadPaths } : {}),
          }),
          session,
          verifyToolchain,
        ),
      );
      if (this.options.enableCandidateVerification && context.toolchain) {
        tools.push(
          context.operations.wrapVerificationTool(
            createVerificationTool({
              workspaceRoot: session.root,
              toolchainRoot: session.sourceRoot,
              sandbox: this.options.sandbox,
            }),
            session,
            verifyToolchain,
          ),
        );
      }
    }
    return tools;
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
    if (context.toolchain) {
      await assertSubagentWorktreeToolchainStable(context.toolchain);
    }
    const candidate = await finalizeSubagentWorktree(session, signal);
    const review = createSubagentWorktreeReview(candidate.changes);
    const modifiedFiles = subagentWorktreeModifiedLspFiles(candidate.changes);
    const candidateVerification = context.operations.summarize(
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
      ...(context.toolchain
        ? { candidateToolchainSha256: context.toolchain.contentSha256 }
        : {}),
    };
  }

  cleanup(session: SubagentWorktreeSession): Promise<void> {
    this.contexts.delete(session);
    return removeSubagentWorktree(session.root);
  }

  async apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeApplyResult> {
    const execution = await this.coordinator.apply(previewId, signal);
    const {
      expectedFiles: _expectedFiles,
      addedFileCount: _addedFileCount,
      modifiedFileCount: _modifiedFileCount,
      deletedFileCount: _deletedFileCount,
      ...durableOutcome
    } = execution.outcome;
    const base = {
      kind: "napier.subagent-worktree-apply" as const,
      schemaVersion: 1 as const,
      ...durableOutcome,
      taskId: execution.source.taskId,
      outcomeSha256: execution.source.outcomeSha256,
      sourceSnapshotSha256: execution.source.sourceSnapshotSha256,
      sourceFileCount: execution.source.sourceFileCount,
      sourceBytes: execution.source.sourceBytes,
      writeScopeCount: execution.source.writeScopeCount,
      writeScopeSetSha256: execution.source.writeScopeSetSha256,
      changedFileSetSha256: execution.source.changedFileSetSha256,
      candidateAddedFileCount: execution.source.addedFileCount,
      candidateModifiedFileCount: execution.source.modifiedFileCount,
      candidateDeletedFileCount: execution.source.deletedFileCount,
      candidateRenamedFileCount: execution.source.renamedFileCount,
      candidateVerificationAttemptCount:
        execution.source.candidateVerificationAttemptCount,
      candidateVerificationFreshCount:
        execution.source.candidateVerificationFreshCount,
      candidateVerificationPassedCount:
        execution.source.candidateVerificationPassedCount,
      candidateVerificationFailedCount:
        execution.source.candidateVerificationFailedCount,
      candidateVerificationStaleCount:
        execution.source.candidateVerificationStaleCount,
      candidateVerificationSetSha256:
        execution.source.candidateVerificationSetSha256,
      ...(execution.source.candidateToolchainSha256
        ? {
            candidateToolchainSha256: execution.source.candidateToolchainSha256,
          }
        : {}),
      ...(execution.diagnostics
        ? { diagnostics: execution.diagnostics.details }
        : {}),
      ...(execution.tests ? { tests: execution.tests.details } : {}),
    };
    const details: SubagentWorktreeApplyDetails = {
      ...base,
      resultSha256: sha256(canonicalJson(base)),
    };
    return {
      details,
      summary: formatLspWorkspaceEditApplySummary({
        label: "Subagent worktree apply",
        details,
        ...(execution.diagnostics
          ? { diagnosticsSummary: execution.diagnostics.summary }
          : {}),
        ...(execution.tests ? { testsSummary: execution.tests.summary } : {}),
        appliedMessage:
          "The reviewed coder candidate is committed. Diagnostics and related-test evidence above describe the merged workspace.",
        rolledBackMessage:
          "The candidate commit failed and every changed file was restored. Delegate or preview again before retrying.",
        indeterminateMessage:
          "Workspace state is indeterminate. Inspect every candidate path before another write.",
      }),
    };
  }
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

export type SubagentWorktreeDiagnosticsDetails =
  LspRenameApplyDiagnosticsDetails;
