import type {
  WorkspaceProcessDeltaStatus,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessOutputChunk,
  WorkspaceProcessResizeReceipt,
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
  WorkspaceProcessWritePreview,
} from "@napier/contracts";

import { canonicalJson, sha256 } from "./ed25519.js";
import { MAX_WORKSPACE_PROCESS_RESIZES } from "./workspace-process-terminal.js";

export interface WorkspaceProcessToolDetails {
  action:
    | "start"
    | "preview_write"
    | "start_write"
    | "input"
    | "poll"
    | "resize"
    | "cancel";
  processId?: string;
  previewId?: string;
  previewSha256?: string;
  status?: WorkspaceProcessStatus;
  nextCursor: number;
  outputAvailable: boolean;
  workspaceAccess?: "read_only" | "scoped_write";
  writeScopeCount?: number;
  writeScopeSetSha256?: string;
  workspaceWriteScopeStatus?:
    | "within_scope"
    | "outside_scope"
    | "indeterminate";
  workspaceDeltaStatus?: WorkspaceProcessDeltaStatus;
  workspaceChangedFileCount?: number;
  chunkCount: number;
  stdinOpen?: boolean;
  stdinWriteCount?: number;
  stdinBytes?: number;
  inputReceiptSha256?: string;
  resizeReceiptSha256?: string;
  ioMode?: "pipe" | "pty";
  terminalColumns?: number;
  terminalRows?: number;
  terminalResizeCount?: number;
  resultSha256: string;
}

export function workspaceProcessToolResult(
  action: WorkspaceProcessToolDetails["action"],
  session: WorkspaceProcessSession,
  chunks: WorkspaceProcessOutputChunk[],
  inputReceipt?: WorkspaceProcessInputReceipt,
  resizeReceipt?: WorkspaceProcessResizeReceipt,
) {
  const chunkSetSha256 = sha256(
    canonicalJson(
      chunks.map((chunk) => ({
        cursor: chunk.cursor,
        stream: chunk.stream,
        textSha256: sha256(chunk.text),
      })),
    ),
  );
  const details: WorkspaceProcessToolDetails = {
    action,
    processId: session.id,
    status: session.status,
    nextCursor: chunks.at(-1)?.cursor ?? session.nextCursor,
    outputAvailable: session.outputAvailable,
    workspaceAccess: session.workspaceAccess,
    ...(session.writeScopeCount !== undefined
      ? { writeScopeCount: session.writeScopeCount }
      : {}),
    ...(session.writeScopeSetSha256
      ? { writeScopeSetSha256: session.writeScopeSetSha256 }
      : {}),
    ...(session.workspaceWriteScopeStatus
      ? { workspaceWriteScopeStatus: session.workspaceWriteScopeStatus }
      : {}),
    ...(session.workspaceDeltaStatus
      ? { workspaceDeltaStatus: session.workspaceDeltaStatus }
      : {}),
    ...(session.workspaceChangedFileCount !== undefined
      ? { workspaceChangedFileCount: session.workspaceChangedFileCount }
      : {}),
    chunkCount: chunks.length,
    ...(session.stdinOpen !== undefined
      ? { stdinOpen: session.stdinOpen }
      : {}),
    ...(session.stdinWriteCount !== undefined
      ? { stdinWriteCount: session.stdinWriteCount }
      : {}),
    ...(session.stdinBytes !== undefined
      ? { stdinBytes: session.stdinBytes }
      : {}),
    ...(inputReceipt ? { inputReceiptSha256: inputReceipt.contentSha256 } : {}),
    ...(resizeReceipt
      ? { resizeReceiptSha256: resizeReceipt.contentSha256 }
      : {}),
    ...(session.ioMode ? { ioMode: session.ioMode } : {}),
    ...(session.terminalColumns !== undefined
      ? { terminalColumns: session.terminalColumns }
      : {}),
    ...(session.terminalRows !== undefined
      ? { terminalRows: session.terminalRows }
      : {}),
    ...(session.terminalResizeCount !== undefined
      ? { terminalResizeCount: session.terminalResizeCount }
      : {}),
    resultSha256: sha256(
      canonicalJson({
        action,
        processId: session.id,
        status: session.status,
        workspaceAccess: session.workspaceAccess,
        writeScopeCount: session.writeScopeCount ?? null,
        writeScopeSetSha256: session.writeScopeSetSha256 ?? null,
        workspaceWriteScopeStatus: session.workspaceWriteScopeStatus ?? null,
        nextCursor: chunks.at(-1)?.cursor ?? session.nextCursor,
        chunkCount: chunks.length,
        chunkSetSha256,
        sessionSha256: session.contentSha256,
        workspaceDeltaStatus: session.workspaceDeltaStatus ?? null,
        workspaceChangedFileCount: session.workspaceChangedFileCount ?? null,
        stdinOpen: session.stdinOpen ?? null,
        stdinWriteCount: session.stdinWriteCount ?? null,
        stdinBytes: session.stdinBytes ?? null,
        inputReceiptSha256: inputReceipt?.contentSha256 ?? null,
        resizeReceiptSha256: resizeReceipt?.contentSha256 ?? null,
        ioMode: session.ioMode ?? null,
        terminalColumns: session.terminalColumns ?? null,
        terminalRows: session.terminalRows ?? null,
        terminalResizeCount: session.terminalResizeCount ?? null,
      }),
    ),
  };
  const lines = [
    `Process ${session.id}: ${session.status}`,
    `Cursor: ${details.nextCursor}`,
    `Output available: ${String(session.outputAvailable)}`,
    `Workspace access: ${session.workspaceAccess}`,
    ...(session.writeScopeCount !== undefined
      ? [
          `Write scopes: ${session.writeScopeCount} / ${session.writeScopeSetSha256}`,
          `Write scope verification: ${session.workspaceWriteScopeStatus ?? "pending"}`,
        ]
      : []),
    `I/O mode: ${session.ioMode ?? "legacy-pipe"}`,
    `Stdin: ${session.stdinMode ?? "closed"} / ${
      session.stdinOpen ? "open" : "closed"
    }`,
    `Input: ${session.stdinWriteCount ?? 0} writes / ${
      session.stdinBytes ?? 0
    } bytes`,
    ...(session.ioMode === "pty"
      ? [
          `Terminal: ${session.terminalType} / ${session.terminalColumns}x${session.terminalRows}`,
          `Terminal resizes: ${session.terminalResizeCount ?? 0} / ${MAX_WORKSPACE_PROCESS_RESIZES}`,
        ]
      : []),
    `Workspace delta: ${session.workspaceDeltaStatus ?? "pending"}`,
    `${session.schemaVersion === 5 ? "Workspace changed paths" : "Workspace changed files"}: ${
      session.workspaceDeltaStatus === "indeterminate"
        ? "unknown"
        : (session.workspaceChangedFileCount ?? "unknown")
    }`,
    `Session SHA-256: ${session.contentSha256}`,
    ...(inputReceipt
      ? [`Input receipt SHA-256: ${inputReceipt.contentSha256}`]
      : []),
    ...(resizeReceipt
      ? [`Resize receipt SHA-256: ${resizeReceipt.contentSha256}`]
      : []),
  ];
  if (chunks.length > 0) {
    lines.push(
      "",
      "OUTPUT",
      ...chunks.map(
        (chunk) => `[${chunk.stream} @${chunk.cursor}]\n${chunk.text}`,
      ),
    );
  }
  return {
    content: [{ type: "text" as const, text: lines.join("\n") }],
    details,
  };
}

export function workspaceProcessWritePreviewToolResult(
  preview: WorkspaceProcessWritePreview,
) {
  const details: WorkspaceProcessToolDetails = {
    action: "preview_write",
    previewId: preview.id,
    previewSha256: preview.contentSha256,
    nextCursor: 0,
    outputAvailable: false,
    chunkCount: 0,
    workspaceAccess: "scoped_write",
    writeScopeCount: preview.writeScopeCount,
    writeScopeSetSha256: preview.writeScopeSetSha256,
    ioMode: preview.ioMode,
    ...(preview.terminalColumns !== undefined
      ? { terminalColumns: preview.terminalColumns }
      : {}),
    ...(preview.terminalRows !== undefined
      ? { terminalRows: preview.terminalRows }
      : {}),
    resultSha256: sha256(
      canonicalJson({
        previewId: preview.id,
        previewSha256: preview.contentSha256,
        commandSha256: preview.commandSha256,
        workspaceBeforeSha256: preview.workspaceBeforeSha256,
        writeScopeCount: preview.writeScopeCount,
        writeScopeSetSha256: preview.writeScopeSetSha256,
      }),
    ),
  };
  return {
    content: [
      {
        type: "text" as const,
        text: [
          `Scoped write preview ${preview.id}`,
          `Preview SHA-256: ${preview.contentSha256}`,
          `Command SHA-256: ${preview.commandSha256}`,
          `Workspace before SHA-256: ${preview.workspaceBeforeSha256}`,
          `Workspace: ${preview.workspaceBeforeFileCount} files / ${preview.workspaceBeforeBytes} bytes`,
          `Write scopes: ${preview.writeScopeCount} / ${preview.writeScopeSetSha256}`,
          `I/O mode: ${preview.ioMode}`,
          `Expires: ${preview.expiresAt}`,
          "Start only with start_write and this one-use preview ID.",
        ].join("\n"),
      },
    ],
    details,
  };
}
