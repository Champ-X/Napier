import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { JsonValue } from "@napier/contracts";
import { Type } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import {
  MAX_WORKSPACE_PROCESS_INPUT_BYTES,
  MAX_WORKSPACE_PROCESS_POLL_WAIT_MS,
  type WorkspaceProcessManager,
} from "./workspace-processes.js";
import {
  MAX_TERMINAL_COLUMNS,
  MAX_TERMINAL_ROWS,
  MIN_TERMINAL_COLUMNS,
  MIN_TERMINAL_ROWS,
} from "./sandbox-terminal.js";
import {
  type WorkspaceProcessToolDetails,
  workspaceProcessToolResult as toolResult,
  workspaceProcessWritePreviewToolResult as writePreviewToolResult,
} from "./workspace-process-tool-result.js";
import { workspaceProcessWriteActionSchema } from "./workspace-process-write-tool-schema.js";

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
      terminal: Type.Object(
        {
          columns: Type.Integer({
            minimum: MIN_TERMINAL_COLUMNS,
            maximum: MAX_TERMINAL_COLUMNS,
          }),
          rows: Type.Integer({
            minimum: MIN_TERMINAL_ROWS,
            maximum: MAX_TERMINAL_ROWS,
          }),
        },
        { additionalProperties: false },
      ),
    },
    { additionalProperties: false },
  ),
  Type.Object(
    {
      action: Type.Literal("resize"),
      processId: Type.String({
        pattern: "^process_[a-z0-9]{8,80}$",
      }),
      columns: Type.Integer({
        minimum: MIN_TERMINAL_COLUMNS,
        maximum: MAX_TERMINAL_COLUMNS,
      }),
      rows: Type.Integer({
        minimum: MIN_TERMINAL_ROWS,
        maximum: MAX_TERMINAL_ROWS,
      }),
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
  workspaceProcessWriteActionSchema,
]);
Object.assign(workspaceProcessSchema, { type: "object" });

export type { WorkspaceProcessToolDetails } from "./workspace-process-tool-result.js";

export function createWorkspaceProcessTool(
  manager: WorkspaceProcessManager,
  context: { threadId: string; runId: string },
): AgentTool<typeof workspaceProcessSchema, WorkspaceProcessToolDetails> {
  return {
    name: "workspace_process",
    label: "Workspace process",
    description:
      "Start, send bounded input to, poll, resize, or cancel a background Node Process Session. Ordinary starts are read-only. Workspace writes require preview_write with 1-8 existing explicit scopes followed by one-use start_write; the Sandbox keeps the rest of the workspace read-only and settlement verifies the observed Delta. All starts use explicit argv, denied network access, and a fixed environment. Choose either pipe interactive mode or a bounded PTY. Input and output text are ephemeral and redacted from Ledger evidence.",
    parameters: workspaceProcessSchema,
    async execute(_toolCallId, input, signal) {
      if (input.action === "preview_write") {
        const preview = await manager.previewWrite({
          ...context,
          command: {
            runtime: input.runtime,
            args: input.args,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
          },
          writePaths: input.writePaths,
          ...("terminal" in input ? { terminal: input.terminal } : {}),
          ...("interactive" in input && input.interactive === true
            ? { interactive: true }
            : {}),
          ...(signal ? { signal } : {}),
        });
        return writePreviewToolResult(preview);
      }
      if (input.action === "start_write") {
        const session = await manager.startWrite({
          ...context,
          previewId: input.previewId,
          ...(signal ? { signal } : {}),
        });
        return toolResult("start_write", session, []);
      }
      if (input.action === "start") {
        const session = await manager.start({
          ...context,
          command: {
            runtime: input.runtime,
            args: input.args,
            ...(input.cwd ? { cwd: input.cwd } : {}),
            ...(input.timeoutMs ? { timeoutMs: input.timeoutMs } : {}),
          },
          ...("terminal" in input ? { terminal: input.terminal } : {}),
          ...("interactive" in input && input.interactive === true
            ? { interactive: true }
            : {}),
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
      if (input.action === "resize") {
        const receipt = await manager.resize({
          ...context,
          processId: input.processId,
          columns: input.columns,
          rows: input.rows,
          initiatedBy: "agent",
          ...(signal ? { signal } : {}),
        });
        const session = (await manager.list(context.threadId)).find(
          (candidate) => candidate.id === input.processId,
        );
        if (!session) throw new Error("Workspace Process Session not found");
        return toolResult("resize", session, [], undefined, receipt);
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
    value["action"] === "preview_write" ||
    value["action"] === "start_write" ||
    value["action"] === "input" ||
    value["action"] === "poll" ||
    value["action"] === "resize" ||
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
    ...(typeof value["previewId"] === "string"
      ? { previewId: value["previewId"] }
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
    ...(Array.isArray(value["writePaths"])
      ? {
          writeScopeCount: value["writePaths"].length,
          writeScopeSetSha256: sha256(
            canonicalJson(
              value["writePaths"].map((writePath) => ({
                pathSha256: sha256(String(writePath)),
              })),
            ),
          ),
        }
      : {}),
    ...(record(value["terminal"]) &&
    Number.isSafeInteger(value["terminal"]["columns"]) &&
    Number.isSafeInteger(value["terminal"]["rows"])
      ? {
          terminalColumns: Number(value["terminal"]["columns"]),
          terminalRows: Number(value["terminal"]["rows"]),
        }
      : {}),
    ...(value["action"] === "resize" &&
    Number.isSafeInteger(value["columns"]) &&
    Number.isSafeInteger(value["rows"])
      ? {
          terminalColumns: Number(value["columns"]),
          terminalRows: Number(value["rows"]),
        }
      : {}),
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

function workspaceProcessCallSha256(args: unknown): string {
  return sha256(canonicalJson({ toolName: "workspace_process", args }));
}

function record(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
