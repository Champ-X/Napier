import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import type { WorkflowValueSchema } from "@napier/contracts";
import type {
  SubagentCollectedOutcome,
  SubagentHandle,
  SubagentRequest,
} from "@napier/contracts/subagent-supervisor";
import { Type, type Static } from "typebox";

import { canonicalJson, sha256 } from "./ed25519.js";
import { subagentJsonValue } from "./subagent-task-evidence.js";
import type { SubagentSupervisor } from "./subagent-supervisor.js";
import { MAX_SUBAGENT_WORKTREE_WRITE_FILES } from "./subagent-worktree-files.js";

const startSchema = Type.Object(
  {
    role: Type.Union([
      Type.Literal("researcher"),
      Type.Literal("reviewer"),
      Type.Literal("general"),
      Type.Literal("coder"),
    ]),
    description: Type.String({ minLength: 1, maxLength: 180 }),
    task: Type.String({ minLength: 1, maxLength: 8_000 }),
    writePaths: Type.Optional(
      Type.Array(Type.String({ minLength: 1, maxLength: 500 }), {
        minItems: 1,
        maxItems: MAX_SUBAGENT_WORKTREE_WRITE_FILES,
      }),
    ),
    outputSchema: Type.Optional(Type.Unknown()),
    revivedFromTaskId: Type.Optional(
      Type.String({ minLength: 1, maxLength: 80 }),
    ),
  },
  { additionalProperties: false },
);
const handleProperties = {
  taskId: Type.String({ minLength: 1, maxLength: 80 }),
  executionId: Type.String({ minLength: 1, maxLength: 80 }),
};
const handleSchema = Type.Object(handleProperties, { additionalProperties: false });
const sendSchema = Type.Object(
  {
    ...handleProperties,
    kind: Type.Optional(
      Type.Union([Type.Literal("steering"), Type.Literal("input")]),
    ),
    text: Type.String({ minLength: 1, maxLength: 8_000 }),
  },
  { additionalProperties: false },
);
const cancelSchema = Type.Object(
  {
    ...handleProperties,
    reason: Type.String({ minLength: 1, maxLength: 500 }),
  },
  { additionalProperties: false },
);

export type SubagentStartToolInput = Static<typeof startSchema>;
type HandleInput = Static<typeof handleSchema>;
type SendInput = Static<typeof sendSchema>;
type CancelInput = Static<typeof cancelSchema>;
const SUPERVISOR_TOOL_NAMES = new Set([
  "subagent_start",
  "subagent_send",
  "subagent_inspect",
  "subagent_cancel",
  "subagent_collect",
]);

export function isSubagentSupervisorToolName(toolName: string): boolean {
  return SUPERVISOR_TOOL_NAMES.has(toolName);
}

export function createSubagentSupervisorTools(input: {
  providerId: string;
  supervisor: SubagentSupervisor;
  start(request: SubagentStartToolInput, signal?: AbortSignal): Promise<SubagentHandle>;
  collectResult(collected: SubagentCollectedOutcome): AgentToolResult<unknown>;
}): AgentTool[] {
  const handle = (value: HandleInput): SubagentHandle => ({
    kind: "napier.subagent-handle",
    schemaVersion: 1,
    providerId: input.providerId,
    taskId: value.taskId,
    executionId: value.executionId,
  });
  return [
    {
      name: "subagent_start",
      label: "Start subagent",
      description:
        "Start supervised child work without blocking. Save taskId and executionId for send, inspect, cancel, or collect. Coder work remains isolated until explicitly applied.",
      parameters: startSchema,
      execute: async (_id, request, signal) => {
        const started = await input.start(request as SubagentStartToolInput, signal);
        return toolResult(`Started supervised Subagent ${started.taskId}.`, started);
      },
    },
    {
      name: "subagent_send",
      label: "Steer subagent",
      description:
        "Queue durable steering or input for a running supervised Subagent; delivery occurs at the next safe assistant boundary.",
      parameters: sendSchema,
      execute: async (_id, request) => {
        const typed = request as SendInput;
        const message = await input.supervisor.send(handle(typed), {
          ...(typed.kind ? { kind: typed.kind } : {}),
          text: typed.text,
        });
        return toolResult(`Accepted message ${message.id} for ${message.taskId}.`, {
          taskId: message.taskId,
          messageId: message.id,
          messageKind: message.messageKind,
          contentSha256: message.contentSha256,
          status: "accepted",
        });
      },
    },
    {
      name: "subagent_inspect",
      label: "Inspect subagent",
      description:
        "Inspect durable status, progress, route, and mailbox counters for a supervised Subagent.",
      parameters: handleSchema,
      execute: async (_id, request) => {
        const snapshot = await input.supervisor.inspect(handle(request as HandleInput));
        return toolResult(
          `Subagent ${snapshot.handle.taskId}: ${snapshot.status}; steps=${snapshot.stepCount}; turns=${snapshot.turnCount}; pendingMessages=${snapshot.mailbox.pendingCount}.`,
          snapshot,
        );
      },
    },
    {
      name: "subagent_cancel",
      label: "Cancel subagent",
      description: "Cancel a supervised Subagent with a durable reason.",
      parameters: cancelSchema,
      execute: async (_id, request) => {
        const typed = request as CancelInput;
        const bound = handle(typed);
        await input.supervisor.cancel(bound, typed.reason);
        const snapshot = await input.supervisor.inspect(bound);
        return toolResult(`Subagent ${bound.taskId}: ${snapshot.status}.`, snapshot);
      },
    },
    {
      name: "subagent_collect",
      label: "Collect subagent",
      description:
        "Wait for a supervised Subagent terminal state and collect its typed output or grounded outcome.",
      parameters: handleSchema,
      execute: async (_id, request) =>
        input.collectResult(
          await input.supervisor.collect(handle(request as HandleInput)),
        ),
    },
  ];
}

export function subagentRequestFromToolInput(
  input: SubagentStartToolInput,
  owner: {
    threadId: string;
    runId: string;
    modelRoute?: SubagentRequest["modelRoute"];
  },
): SubagentRequest {
  return {
    kind: "napier.subagent-request",
    schemaVersion: 1,
    threadId: owner.threadId,
    runId: owner.runId,
    role: input.role,
    description: input.description.trim(),
    prompt: input.task.trim(),
    ...(owner.modelRoute ? { modelRoute: owner.modelRoute } : {}),
    ...(input.outputSchema
      ? { outputSchema: input.outputSchema as WorkflowValueSchema }
      : {}),
    ...(input.writePaths ? { writePaths: input.writePaths } : {}),
    ...(input.revivedFromTaskId
      ? { revivedFromTaskId: input.revivedFromTaskId }
      : {}),
  };
}

export function subagentSupervisorToolInputProjection(
  toolName: string,
  value: unknown,
) {
  const input = record(value);
  return {
    inputSha256: sha256(canonicalJson(value)),
    inputRedacted: true,
    ...(typeof input?.["taskId"] === "string"
      ? { taskId: input["taskId"] }
      : {}),
    ...(toolName === "subagent_start" && typeof input?.["role"] === "string"
      ? { role: input["role"] }
      : {}),
  };
}

export function subagentSupervisorToolOutputProjection(
  output: string,
  result: unknown,
) {
  const details = record(record(result)?.["details"]);
  const handle = record(details?.["handle"]);
  return {
    outputSha256: sha256(output),
    outputBytes: Buffer.byteLength(output, "utf8"),
    outputRedacted: true,
    ...(typeof details?.["taskId"] === "string"
      ? { taskId: details["taskId"] }
      : typeof handle?.["taskId"] === "string"
        ? { taskId: handle["taskId"] }
        : {}),
    ...(typeof details?.["status"] === "string"
      ? { status: details["status"] }
      : {}),
  };
}

function toolResult(text: string, details: unknown): AgentToolResult<unknown> {
  return {
    content: [{ type: "text", text }],
    details: subagentJsonValue(details),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
