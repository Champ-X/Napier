import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  JsonValue,
  LspRenameApplyDiagnosticsDetails,
  SubagentWorktreeApplyDetails,
} from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  LspRenameApplyDiagnostics,
  type LspRenameDiagnosticsObservation,
  type LspRenameDiagnosticsState,
  unavailableLspRenameDiagnostics,
} from "./lsp-rename-apply-diagnostics.js";
import {
  commitLspRename,
  type CommitLspRenameOptions,
} from "./lsp-rename-commit.js";
import type { LspRenameFile } from "./lsp-rename-workspace-edit.js";
import {
  formatLspWorkspaceEditApplySummary,
  LspWorkspaceEditMutationCoordinator,
  type LspWorkspaceEditDiagnosticsAdapter,
  type LspWorkspaceEditPreviewSource,
} from "./lsp-workspace-edit-mutation.js";
import type { OsSandboxAdapter } from "./sandbox.js";
import {
  createSubagentWorktree,
  finalizeSubagentWorktree,
  observeSubagentWorktreeSource,
  removeSubagentWorktree,
  type SubagentWorktreeSession,
} from "./subagent-worktree-files.js";
import { createSubagentWorktreeReview } from "./subagent-worktree-review.js";
import { createTypescriptAstTools } from "./typescript-ast-tool.js";
import {
  applyWorkspacePatch,
  createWorkspaceTools,
  type WorkspacePatchInput,
} from "./tools.js";
import { createWorkspacePatchTool } from "./workspace-patch-tool.js";
import type { WriteLinkedTestVerificationRunner } from "./write-linked-test-verification.js";

const applySchema = Type.Object(
  {
    previewId: Type.String({
      minLength: 1,
      maxLength: 120,
      description:
        "Opaque one-use preview ID returned by a completed coder delegation.",
    }),
  },
  { additionalProperties: false },
);

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
  files: LspRenameFile[];
}

export interface SubagentWorktreePreview {
  id: string;
  expiresAt: string;
  taskId: string;
  changedPaths: string[];
  changedFileCount: number;
  changedFileSetSha256: string;
  sourceSnapshotSha256: string;
  review: string;
  reviewTruncated: boolean;
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
  diagnostics?: LspWorkspaceEditDiagnosticsAdapter<
    LspRenameDiagnosticsState,
    LspRenameDiagnosticsObservation
  >;
  tests?: Pick<WriteLinkedTestVerificationRunner, "captureBefore" | "run">;
  now?: () => Date;
  commit?: typeof commitLspRename;
  commitOptions?: Pick<CommitLspRenameOptions, "renameFile" | "linkFile">;
}

export class SubagentWorktreeMutationManager {
  private readonly coordinator: LspWorkspaceEditMutationCoordinator<
    WorktreePreviewSource,
    LspRenameDiagnosticsState,
    LspRenameDiagnosticsObservation
  >;

  constructor(
    private readonly options: SubagentWorktreeMutationManagerOptions,
  ) {
    const diagnostics =
      options.diagnostics ??
      (options.sandbox
        ? defaultDiagnostics(options.workspaceRoot, options.sandbox)
        : undefined);
    if (!diagnostics) {
      throw new Error("Subagent worktree merge diagnostics are required");
    }
    this.coordinator = new LspWorkspaceEditMutationCoordinator({
      workspaceRoot: options.workspaceRoot,
      dataRoot: options.dataRoot,
      label: "Subagent worktree apply",
      previewPrefix: "subworkpreview",
      diagnostics,
      preflight: (source, signal) =>
        observeSubagentWorktreeSource(source, signal),
      ...(options.tests ? { tests: options.tests } : {}),
      ...(options.now ? { now: options.now } : {}),
      ...(options.commit ? { commit: options.commit } : {}),
      ...(options.commitOptions
        ? { commitOptions: options.commitOptions }
        : {}),
    });
  }

  createWorktree(
    taskId: string,
    writePaths: string[],
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeSession> {
    return createSubagentWorktree({
      workspaceRoot: this.options.workspaceRoot,
      dataRoot: this.options.dataRoot,
      ownerId: this.options.ownerId,
      taskId,
      writePaths,
      ...(signal ? { signal } : {}),
    });
  }

  createCoderTools(session: SubagentWorktreeSession): AgentTool[] {
    const tools = [
      ...createWorkspaceTools(session.root),
      ...createTypescriptAstTools(session.root),
    ];
    tools.push(
      createWorkspacePatchTool({
        workspaceRoot: session.root,
        dataRoot: this.options.dataRoot,
        applyPatch: async (workspaceRoot, dataRoot, input) => {
          assertAuthorizedPatch(session, input);
          return applyWorkspacePatch(workspaceRoot, dataRoot, input);
        },
      }),
    );
    return tools;
  }

  async storePreview(
    session: SubagentWorktreeSession,
    outcomeSha256: string,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreePreview> {
    if (!hash(outcomeSha256)) {
      throw new Error("Subagent worktree outcome hash is invalid");
    }
    const candidate = await finalizeSubagentWorktree(session, signal);
    const review = createSubagentWorktreeReview(candidate.files);
    const receipt = {
      taskId: session.taskId,
      outcomeSha256,
      sourceSnapshotSha256: session.sourceSnapshotSha256,
      sourceFileCount: session.sourceFileCount,
      sourceBytes: session.sourceBytes,
      writeScopeCount: session.writePaths.length,
      writeScopeSetSha256: session.writeScopeSetSha256,
      changedFileCount: candidate.files.length,
      changedFileSetSha256: candidate.changedFileSetSha256,
    };
    await removeSubagentWorktree(session.root);
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
      files: candidate.files,
    });
    if (!stored) {
      throw new Error("Subagent worktree merge preview could not be stored");
    }
    return {
      id: stored.id,
      expiresAt: stored.expiresAt,
      taskId: session.taskId,
      changedPaths: candidate.changedPaths,
      changedFileCount: candidate.files.length,
      changedFileSetSha256: candidate.changedFileSetSha256,
      sourceSnapshotSha256: session.sourceSnapshotSha256,
      review: review.text,
      reviewTruncated: review.truncated,
    };
  }

  cleanup(session: SubagentWorktreeSession): Promise<void> {
    return removeSubagentWorktree(session.root);
  }

  async apply(
    previewId: string,
    signal?: AbortSignal,
  ): Promise<SubagentWorktreeApplyResult> {
    const execution = await this.coordinator.apply(previewId, signal);
    const { expectedFiles: _expectedFiles, ...durableOutcome } =
      execution.outcome;
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

export function createSubagentWorktreeApplyTool(
  manager: SubagentWorktreeMutationManager,
): AgentTool<typeof applySchema, SubagentWorktreeApplyDetails> {
  return {
    name: "subagent_worktree_apply",
    label: "Apply coder worktree",
    description:
      "Apply one reviewed coder Subagent worktree through its opaque one-use preview. The source workspace must still match the complete fork snapshot; multi-file commit, rollback, diagnostics, and enabled related tests are coordinated by Napier.",
    parameters: applySchema,
    async execute(_toolCallId, input, signal) {
      const applied = await manager.apply(input.previewId, signal);
      return {
        content: [{ type: "text", text: applied.summary }],
        details: applied.details,
      };
    },
  };
}

export function subagentWorktreeToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    inputSha256: sha256(
      canonicalJson({ toolName: "subagent_worktree_apply", args }),
    ),
  };
}

export function subagentWorktreeToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: sha256(canonicalJson(args)),
    inputRedacted: true,
  };
}

export function subagentWorktreeToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const value = record(result);
  const details = record(value?.["details"]);
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(details && hash(details["resultSha256"])
      ? { resultSha256: details["resultSha256"] }
      : {}),
  };
}

function defaultDiagnostics(
  workspaceRoot: string,
  sandbox: OsSandboxAdapter,
): LspWorkspaceEditDiagnosticsAdapter<
  LspRenameDiagnosticsState,
  LspRenameDiagnosticsObservation
> {
  const diagnostics = new LspRenameApplyDiagnostics({
    workspaceRoot,
    sandbox,
  });
  return {
    observeBefore: (files, signal) => diagnostics.observeBefore(files, signal),
    observeAfter: (state, files, signal) =>
      diagnostics.observeAfter(state, files, signal),
    unavailable: unavailableLspRenameDiagnostics,
  };
}

function assertAuthorizedPatch(
  session: SubagentWorktreeSession,
  input: WorkspacePatchInput,
): void {
  if (
    input.operation === "create" ||
    !session.writePaths.includes(input.path) ||
    input.expectedSha256 === null
  ) {
    throw new Error(
      "Coder Subagent apply_patch is limited to declared existing write paths",
    );
  }
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/u.test(value);
}

export type SubagentWorktreeDiagnosticsDetails =
  LspRenameApplyDiagnosticsDetails;
