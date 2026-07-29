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

const visiblePath = Type.String({
  minLength: 1,
  maxLength: 500,
  pattern: "^[^\\u0000-\\u001f\\u007f]+$",
});

const previewSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("list_trash"),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("preview"),
      operation: Type.Literal("create_directory"),
      path: visiblePath,
      createParentDirectories: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("preview"),
      operation: Type.Literal("move"),
      sourcePath: visiblePath,
      destinationPath: visiblePath,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("preview"),
      operation: Type.Literal("trash"),
      path: visiblePath,
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("preview"),
      operation: Type.Literal("restore"),
      trashId: Type.String({
        pattern: "^trash_[a-z0-9]{8,80}$",
      }),
    },
    { additionalProperties: false },
  ),
]);

const applySchema = Type.Object(
  {
    previewId: Type.String({
      pattern: "^filepreview_[a-z0-9]{8,80}$",
      description:
        "One-use preview ID returned by workspace_file_preview in this Run.",
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
  return {
    name: "workspace_file_preview",
    label: "Workspace file preview",
    description:
      "Preview a bounded create-directory, move, reversible-trash, or restore operation without mutating the workspace, or list reversible trash. Apply requires the returned one-use preview ID through workspace_file_apply.",
    parameters: previewSchema,
    async execute(_toolCallId, input, signal) {
      if (input.action === "list_trash") {
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
}

export function createWorkspaceFileApplyTool(
  manager: WorkspaceFileMutationManager,
  context: { threadId: string; runId: string },
): AgentTool<typeof applySchema, WorkspaceFileToolDetails> {
  return {
    name: "workspace_file_apply",
    label: "Apply workspace file operation",
    description:
      "Apply one fresh, one-use Workspace file mutation preview. This tool accepts no paths, refuses an occupied destination at its final check, and never performs permanent deletion.",
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
  operation: "create_directory" | "move" | "trash" | "restore";
  path?: string;
  sourcePath?: string;
  destinationPath?: string;
  createParentDirectories?: boolean;
  trashId?: string;
}): WorkspaceFileMutationRequest {
  if (input.operation === "create_directory") {
    return {
      operation: input.operation,
      path: input.path!,
      ...(input.createParentDirectories === true
        ? { createParentDirectories: true }
        : {}),
    };
  }
  if (input.operation === "move") {
    return {
      operation: input.operation,
      sourcePath: input.sourcePath!,
      destinationPath: input.destinationPath!,
    };
  }
  if (input.operation === "trash") {
    return { operation: input.operation, path: input.path! };
  }
  return { operation: input.operation, trashId: input.trashId! };
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
