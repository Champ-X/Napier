import type { AgentTool } from "@earendil-works/pi-agent-core";
import type {
  JsonValue,
  WorkspaceProcessDeltaStatus,
  WorkspaceProcessInputReceipt,
  WorkspaceProcessOutputChunk,
  WorkspaceProcessSession,
  WorkspaceProcessStatus,
} from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_WORKSPACE_PROCESS_INPUT_BYTES,
  MAX_WORKSPACE_PROCESS_POLL_WAIT_MS,
  type WorkspaceProcessManager,
} from "./workspace-processes.js";

const workspaceProcessSchema = Type.Union([
  Type.Object(
    {
      action: Type.Literal("start"),
      runtime: Type.Literal("node"),
      args: Type.Array(
        Type.String({
          maxLength: 2_048,
          pattern: "^[^\\u0000-\\u001f\\u007f]*$",
        }),
        { maxItems: 64 },
      ),
      cwd: Type.Optional(
        Type.String({
          minLength: 1,
          maxLength: 500,
          pattern: "^[^\\u0000-\\u001f\\u007f]*$",
        }),
      ),
      timeoutMs: Type.Optional(
        Type.Integer({ minimum: 1_000, maximum: 120_000 }),
      ),
      interactive: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("input"),
      processId: Type.String({
        pattern: "^process_[a-z0-9]{8,80}$",
      }),
      text: Type.String({
        maxLength: MAX_WORKSPACE_PROCESS_INPUT_BYTES,
      }),
      appendNewline: Type.Optional(Type.Boolean()),
      close: Type.Optional(Type.Boolean()),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("poll"),
      processId: Type.String({
        pattern: "^process_[a-z0-9]{8,80}$",
      }),
      afterCursor: Type.Optional(Type.Integer({ minimum: 0 })),
      waitMs: Type.Optional(
        Type.Integer({
          minimum: 0,
          maximum: MAX_WORKSPACE_PROCESS_POLL_WAIT_MS,
        }),
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("cancel"),
      processId: Type.String({
        pattern: "^process_[a-z0-9]{8,80}$",
      }),
    },
    { additionalProperties: false },
  ),
]);

export interface WorkspaceProcessToolDetails {
  action: "start" | "input" | "poll" | "cancel";
  processId: string;
  status: WorkspaceProcessStatus;
  nextCursor: number;
  outputAvailable: boolean;
  workspaceDeltaStatus?: WorkspaceProcessDeltaStatus;
  workspaceChangedFileCount?: number;
  chunkCount: number;
  stdinOpen?: boolean;
  stdinWriteCount?: number;
  stdinBytes?: number;
  inputReceiptSha256?: string;
  resultSha256: string;
}

export function createWorkspaceProcessTool(
  manager: WorkspaceProcessManager,
  context: { threadId: string; runId: string },
): AgentTool<typeof workspaceProcessSchema, WorkspaceProcessToolDetails> {
  return {
    name: "workspace_process",
    label: "Workspace process",
    description:
      "Start, send bounded input to, poll, or cancel a background Node Process Session. Starts use explicit argv, a read-only workspace, denied network access, and a fixed environment. Input requires explicit interactive mode. Input and output text are ephemeral and redacted from Ledger evidence.",
    parameters: workspaceProcessSchema,
    async execute(_toolCallId, input, signal) {
      if (input.action === "start") {
        const session = await manager.start({
          ...context,
          command: {
            runtime: input.runtime,
            args: input.args,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
          },
          ...(input.interactive === true ? { interactive: true } : {}),
          ...(signal ? { signal } : {}),
        });
        return toolResult("start", session, []);
      }
      if (input.action === "input") {
        const receipt = await manager.writeInput({
          ...context,
          processId: input.processId,
          text: input.text,
          ...(input.appendNewline === true ? { appendNewline: true } : {}),
          ...(input.close === true ? { close: true } : {}),
          initiatedBy: "agent",
          ...(signal ? { signal } : {}),
        });
        const session = (await manager.list(context.threadId)).find(
          (candidate) => candidate.id === input.processId,
        );
        if (!session) throw new Error("Workspace Process Session not found");
        return toolResult("input", session, [], receipt);
      }
      if (input.action === "poll") {
        const output = await manager.output(context.threadId, input.processId, {
          afterCursor: input.afterCursor ?? 0,
          waitMs: input.waitMs ?? 0,
          ...(signal ? { signal } : {}),
        });
        const session = (await manager.list(context.threadId)).find(
          (candidate) => candidate.id === input.processId,
        );
        if (!session) throw new Error("Workspace Process Session not found");
        return toolResult("poll", session, output.chunks);
      }
      const session = await manager.cancel(context.threadId, input.processId);
      return toolResult("cancel", session, []);
    },
  };
}

export function workspaceProcessToolCallArgumentsLedgerProjection(
  args: unknown,
): JsonValue {
  const value = record(args) ? args : {};
  const action =
    value["action"] === "start" ||
    value["action"] === "poll" ||
    value["action"] === "cancel"
      ? value["action"]
      : "unknown";
  const cwd = typeof value["cwd"] === "string" ? value["cwd"] : ".";
  return {
    kind: "napier.redacted-tool-arguments",
    schemaVersion: 1,
    redacted: true,
    action,
    ...(typeof value["processId"] === "string"
      ? { processId: value["processId"] }
      : {}),
    argumentCount: Array.isArray(value["args"]) ? value["args"].length : 0,
    ...(typeof value["text"] === "string"
      ? {
          inputBytes: Buffer.byteLength(
            `${value["text"]}${value["appendNewline"] === true ? "\n" : ""}`,
            "utf8",
          ),
        }
      : {}),
    ...(value["appendNewline"] === true ? { appendNewline: true } : {}),
    ...(value["close"] === true ? { close: true } : {}),
    ...(value["interactive"] === true ? { interactive: true } : {}),
    cwdPathSha256: sha256(cwd),
    inputSha256: workspaceProcessCallSha256(args),
  };
}

export function workspaceProcessToolInputLedgerProjection(
  args: unknown,
): Record<string, JsonValue> {
  return {
    inputSha256: workspaceProcessCallSha256(args),
    inputRedacted: true,
  };
}

export function workspaceProcessToolOutputLedgerProjection(
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

function toolResult(
  action: WorkspaceProcessToolDetails["action"],
  session: WorkspaceProcessSession,
  chunks: WorkspaceProcessOutputChunk[],
  inputReceipt?: WorkspaceProcessInputReceipt,
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
    resultSha256: sha256(
      canonicalJson({
        action,
        processId: session.id,
        status: session.status,
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
      }),
    ),
  };
  const lines = [
    `Process ${session.id}: ${session.status}`,
    `Cursor: ${details.nextCursor}`,
    `Output available: ${String(session.outputAvailable)}`,
    `Stdin: ${session.stdinMode ?? "closed"} / ${
      session.stdinOpen ? "open" : "closed"
    }`,
    `Input: ${session.stdinWriteCount ?? 0} writes / ${
      session.stdinBytes ?? 0
    } bytes`,
    `Workspace delta: ${session.workspaceDeltaStatus ?? "pending"}`,
    `Workspace changed files: ${
      session.workspaceDeltaStatus === "indeterminate"
        ? "unknown"
        : (session.workspaceChangedFileCount ?? "unknown")
    }`,
    `Session SHA-256: ${session.contentSha256}`,
    ...(inputReceipt
      ? [`Input receipt SHA-256: ${inputReceipt.contentSha256}`]
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

function workspaceProcessCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "workspace_process", args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
