import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  JsonValue,
  WorkspaceFileMutationOperation,
} from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import type {
  WorkspaceFileMutationApplyResult,
  WorkspaceFileMutationManager,
  WorkspaceFileMutationPreview,
  WorkspaceFileMutationRequest,
} from "./workspace-file-mutations.js";
import {
  defineToolProgress,
  progressSemantics,
  recordValue,
  resultDetails,
  stableFields,
} from "./tool-progress-semantics.js";
import {
  defineWorkspaceFileApplyProtocol,
  defineWorkspaceFilePreviewProtocol,
} from "./workspace-file-tool-protocol.js";

const visiblePath = Type.String({
  minLength: 1,
  maxLength: 500,
  pattern: "^[^\\u0000-\\u001f\\u007f]+$",
});

const previewSchema = Type.Object(
  {
    action: Type.Union([Type.Literal("list_trash"), Type.Literal("preview")]),
    operation: Type.Optional(
      Type.Union([
        Type.Literal("create_directory"),
        Type.Literal("move"),
        Type.Literal("trash"),
        Type.Literal("restore"),
      ]),
    ),
    path: Type.Optional(visiblePath),
    sourcePath: Type.Optional(visiblePath),
    destinationPath: Type.Optional(visiblePath),
    createParentDirectories: Type.Optional(Type.Boolean()),
    trashId: Type.Optional(
      Type.String({
        pattern: "^trash_[a-z0-9]{8,80}$",
      }),
    ),
  },
  { additionalProperties: false },
);

const applySchema = Type.Object(
  {
    previewId: Type.String({
      pattern: "^filepreview_[a-z0-9]{8,80}$",
    }),
  },
  { additionalProperties: false },
);

export interface WorkspaceFileToolDetails {
  action: "list_trash" | "preview" | "apply";
  status: "listed" | "ready" | "applied";
  operation?: WorkspaceFileMutationOperation;
  previewId?: string;
  trashId?: string;
  itemCount?: number;
  entryKind?: "file" | "directory";
  sourcePathSha256?: string;
  destinationPathSha256?: string;
  beforeSha256?: string;
  afterSha256?: string;
  fileCount?: number;
  directoryCount?: number;
  bytes?: number;
  reversible?: boolean;
  postcondition?: "verified" | "drifted" | "indeterminate";
  resultSha256: string;
}

export function createWorkspaceFilePreviewTool(
  manager: WorkspaceFileMutationManager,
  context: { threadId: string; runId: string },
): AgentTool<typeof previewSchema, WorkspaceFileToolDetails> {
  const tool: AgentTool<typeof previewSchema, WorkspaceFileToolDetails> = {
    name: "workspace_file_preview",
    label: "Workspace file preview",
    description:
      "Use action=list_trash alone, or action=preview with exactly one operation: create_directory(path, optional parents), move(sourcePath,destinationPath), trash(path), or restore(trashId). Preview is bounded and non-mutating; apply its one-use ID via workspace_file_apply.",
    parameters: previewSchema,
    async execute(_toolCallId, input, signal) {
      if (input.action === "list_trash") {
        if (
          input.operation !== undefined ||
          input.path !== undefined ||
          input.sourcePath !== undefined ||
          input.destinationPath !== undefined ||
          input.createParentDirectories !== undefined ||
          input.trashId !== undefined
        ) {
          invalidPreviewRequest();
        }
        const list = await manager.listTrash(context.threadId);
        const details = listedDetails(list.items);
        const lines =
          list.items.length === 0
            ? ["No reversible Workspace trash items are available."]
            : [
                "REVERSIBLE WORKSPACE TRASH",
                ...list.items.map(
                  (item) =>
                    `${item.id} · ${item.entryKind} · ${item.originalPath} · ${item.bytes} bytes · ${item.snapshotSha256}`,
                ),
              ];
        return {
          content: [{ type: "text" as const, text: lines.join("\n") }],
          details,
        };
      }
      const request = previewRequest(input);
      const preview = await manager.preview(
        context.threadId,
        context.runId,
        request,
        signal,
      );
      return previewToolResult(preview);
    },
  };
  return defineWorkspaceFilePreviewProtocol(defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      { modeId: "preview_workspace", operation: "observe", scope: "workspace", contribution: "neutral" },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("observe", "workspace", "neutral"),
      resourceKey: {
        kind: "workspace-file-preview",
        action: recordValue(input)["action"],
      },
    }),
  }));
}

export function createWorkspaceFileApplyTool(
  manager: WorkspaceFileMutationManager,
  context: { threadId: string; runId: string },
): AgentTool<typeof applySchema, WorkspaceFileToolDetails> {
  const tool: AgentTool<typeof applySchema, WorkspaceFileToolDetails> = {
    name: "workspace_file_apply",
    label: "Apply workspace file operation",
    description:
      "Apply one fresh one-use previewId from this Run; no paths accepted. Refuses stale preview or occupied destination at final check and never performs permanent deletion.",
    parameters: applySchema,
    async execute(_toolCallId, input, signal) {
      const result = await manager.apply(
        context.threadId,
        context.runId,
        input.previewId,
        "agent",
        signal,
      );
      return applyToolResult(result);
    },
  };
  return defineWorkspaceFileApplyProtocol(defineToolProgress(tool, {
    schemaVersion: 1,
    classificationVersion: "1.0.0",
    modes: [
      { modeId: "apply_workspace", operation: "mutate", scope: "workspace", contribution: "product" },
    ],
    resolve: (input) => ({
      semantics: progressSemantics("mutate", "workspace", "product"),
      resourceKey: {
        kind: "workspace-file-preview",
        previewId: recordValue(input)["previewId"],
      },
    }),
    state: (_input, result) =>
      stableFields(resultDetails(result), [
        "operation",
        "sourcePathSha256",
        "destinationPathSha256",
        "trashId",
        "afterSha256",
        "resultSha256",
      ]),
  }));
}

export function workspaceFileToolCallArgumentsLedgerProjection(
  toolName: string,
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    toolName,
    action:
      value["action"] === "list_trash" || value["action"] === "preview"
        ? value["action"]
        : toolName === "workspace_file_apply"
          ? "apply"
          : "unknown",
    ...(workspaceOperation(value["operation"])
      ? { operation: workspaceOperation(value["operation"])! }
      : {}),
    ...(validResourceId(value["previewId"], "filepreview")
      ? { previewId: value["previewId"] as string }
      : {}),
    ...(validResourceId(value["trashId"], "trash")
      ? { trashId: value["trashId"] as string }
      : {}),
    ...(typeof value["path"] === "string"
      ? { pathSha256: sha256(value["path"]) }
      : {}),
    ...(typeof value["sourcePath"] === "string"
      ? { sourcePathSha256: sha256(value["sourcePath"]) }
      : {}),
    ...(typeof value["destinationPath"] === "string"
      ? { destinationPathSha256: sha256(value["destinationPath"]) }
      : {}),
    inputSha256: workspaceFileCallSha256(toolName, args),
  };
}

export function workspaceFileToolInputLedgerProjection(
  toolName: string,
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: workspaceFileCallSha256(toolName, args),
    inputRedacted: true,
  };
}

export function workspaceFileToolOutputLedgerProjection(
  output: string,
  result: unknown,
): Record<string, JsonValue> {
  const details =
    record(result) && record(result["details"]) ? result["details"] : undefined;
  const resultSha256 =
    typeof details?.["resultSha256"] === "string" &&
    /^[a-f0-9]{64}$/u.test(details["resultSha256"])
      ? details["resultSha256"]
      : undefined;
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(resultSha256 ? { resultSha256 } : {}),
  };
}

function previewRequest(input: {
  operation?: "create_directory" | "move" | "trash" | "restore";
  path?: string;
  sourcePath?: string;
  destinationPath?: string;
  createParentDirectories?: boolean;
  trashId?: string;
}): WorkspaceFileMutationRequest {
  if (
    input.operation !== "create_directory" &&
    input.createParentDirectories !== undefined
  ) {
    invalidPreviewRequest();
  }
  const fields = [
    input.path,
    input.sourcePath,
    input.destinationPath,
    input.trashId,
  ].filter((value) => value !== undefined).length;
  if (input.operation === "create_directory") {
    if (!input.path || fields !== 1) invalidPreviewRequest();
    return {
      operation: input.operation,
      path: input.path,
      ...(input.createParentDirectories === true
        ? { createParentDirectories: true }
        : {}),
    };
  }
  if (input.operation === "move") {
    if (!input.sourcePath || !input.destinationPath || fields !== 2) {
      invalidPreviewRequest();
    }
    return {
      operation: input.operation,
      sourcePath: input.sourcePath,
      destinationPath: input.destinationPath,
    };
  }
  if (input.operation === "trash") {
    if (!input.path || fields !== 1) invalidPreviewRequest();
    return { operation: input.operation, path: input.path };
  }
  if (input.operation !== "restore" || !input.trashId || fields !== 1) {
    invalidPreviewRequest();
  }
  return { operation: input.operation, trashId: input.trashId };
}

function invalidPreviewRequest(): never {
  throw new Error("Workspace file preview fields do not match operation");
}

function previewToolResult(preview: WorkspaceFileMutationPreview) {
  const details: WorkspaceFileToolDetails = {
    action: "preview",
    status: "ready",
    operation: preview.operation,
    previewId: preview.id,
    ...(preview.trashId ? { trashId: preview.trashId } : {}),
    ...(preview.scope
      ? {
          entryKind: preview.scope.entryKind,
          beforeSha256: preview.scope.snapshotSha256,
          fileCount: preview.scope.fileCount,
          directoryCount: preview.scope.directoryCount,
          bytes: preview.scope.bytes,
        }
      : {}),
    ...(preview.sourcePath
      ? { sourcePathSha256: sha256(preview.sourcePath) }
      : {}),
    ...(preview.destinationPath
      ? { destinationPathSha256: sha256(preview.destinationPath) }
      : {}),
    reversible: preview.reversible,
    resultSha256: sha256(
      canonicalJson({
        action: "preview",
        previewId: preview.id,
        operation: preview.operation,
        planSha256: preview.planSha256,
        expiresAt: preview.expiresAt,
      }),
    ),
  };
  const lines = [
    `Preview ${preview.id}: ${preview.operation}`,
    ...(preview.sourcePath ? [`Source: ${preview.sourcePath}`] : []),
    ...(preview.destinationPath
      ? [`Destination: ${preview.destinationPath}`]
      : []),
    ...(preview.trashId ? [`Trash ID: ${preview.trashId}`] : []),
    ...(preview.scope
      ? [
          `Scope: ${preview.scope.entryKind} · ${preview.scope.fileCount} files · ${preview.scope.directoryCount} directories · ${preview.scope.bytes} bytes`,
          `Snapshot SHA-256: ${preview.scope.snapshotSha256}`,
        ]
      : []),
    ...(preview.createdDirectoryCount !== undefined
      ? [`Directories to create: ${preview.createdDirectoryCount}`]
      : []),
    `Reversible: ${String(preview.reversible)}`,
    `Expires: ${preview.expiresAt}`,
    `Plan SHA-256: ${preview.planSha256}`,
    `Apply only with workspace_file_apply previewId ${preview.id}.`,
  ];
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details,
  };
}

function applyToolResult(result: WorkspaceFileMutationApplyResult) {
  const evidence = result.evidence;
  const details: WorkspaceFileToolDetails = {
    action: "apply",
    status: "applied",
    operation: evidence.operation,
    ...(evidence.trashId ? { trashId: evidence.trashId } : {}),
    ...(evidence.entryKind ? { entryKind: evidence.entryKind } : {}),
    ...(evidence.sourcePathSha256
      ? { sourcePathSha256: evidence.sourcePathSha256 }
      : {}),
    ...(evidence.destinationPathSha256
      ? { destinationPathSha256: evidence.destinationPathSha256 }
      : {}),
    ...(evidence.beforeSha256 ? { beforeSha256: evidence.beforeSha256 } : {}),
    ...(evidence.afterSha256 ? { afterSha256: evidence.afterSha256 } : {}),
    fileCount: evidence.fileCount,
    directoryCount: evidence.directoryCount,
    bytes: evidence.bytes,
    reversible: evidence.reversible,
    postcondition: evidence.postcondition,
    resultSha256: evidence.contentSha256,
  };
  const lines = [
    `Workspace file operation applied: ${evidence.operation}`,
    ...(result.sourcePath ? [`Source: ${result.sourcePath}`] : []),
    ...(result.destinationPath
      ? [`Destination: ${result.destinationPath}`]
      : []),
    ...(evidence.trashId ? [`Trash ID: ${evidence.trashId}`] : []),
    `Scope: ${evidence.fileCount} files · ${evidence.directoryCount} directories · ${evidence.bytes} bytes`,
    `Postcondition: ${evidence.postcondition}`,
    `Reversible: ${String(evidence.reversible)}`,
    `Evidence SHA-256: ${evidence.contentSha256}`,
  ];
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details,
  };
}

function listedDetails(
  items: Array<{
    id: string;
    originalPathSha256: string;
    snapshotSha256: string;
  }>,
): WorkspaceFileToolDetails {
  return {
    action: "list_trash",
    status: "listed",
    itemCount: items.length,
    resultSha256: sha256(
      canonicalJson(
        items.map((item) => ({
          id: item.id,
          originalPathSha256: item.originalPathSha256,
          snapshotSha256: item.snapshotSha256,
        })),
      ),
    ),
  };
}

function workspaceFileCallSha256(toolName: string, args: unknown): string {
  return sha256(canonicalJson({ toolName, args }));
}

function workspaceOperation(
  value: unknown,
): WorkspaceFileMutationOperation | undefined {
  return value === "create_directory" ||
    value === "move" ||
    value === "trash" ||
    value === "restore"
    ? value
    : undefined;
}

function validResourceId(value: unknown, prefix: string): boolean {
  return (
    typeof value === "string" &&
    new RegExp(`^${prefix}_[a-z0-9]{8,80}$`, "u").test(value)
  );
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
