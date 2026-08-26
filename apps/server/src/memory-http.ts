import type {
  CreateMemoryRequest,
  MemoryFact,
  RegisteredRunEventTypeForCategory,
  ReviewMemoryRequest,
} from "@napier/contracts";
import { createId } from "@napier/runtime/core";
import { type LocalStore } from "@napier/runtime/store";
import { Hono, type Context } from "hono";

import {
  errorMessage,
  jsonError,
  setBodyContentSha256Header,
} from "./http-response-evidence.js";
import {
  readLimitedJson,
  RequestBodyTooLargeError,
} from "./http-request-body.js";

const MAX_MEMORY_REQUEST_BYTES = 16 * 1024;

type MemoryHttpStore = Pick<
  LocalStore,
  | "appendEvent"
  | "getThread"
  | "listAgents"
  | "listMemories"
  | "proposeMemory"
  | "reviewMemory"
>;

export function registerMemoryHttp(app: Hono, store: MemoryHttpStore): void {
  app.get("/api/memories", (context) => {
    const agentId = context.req.query("agent");
    const memories = store.listMemories(agentId ? { agentId } : {});
    setMemoryListHeaders(context, memories, agentId);
    return context.json(memories);
  });

  app.post("/api/memories", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_MEMORY_REQUEST_BYTES,
        "Memory proposal request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseCreateMemoryRequest(input);
    if (!body) {
      return jsonError(context, "Memory proposal request is invalid", 400);
    }
    const thread = body.threadId ? store.getThread(body.threadId) : undefined;
    const agentId =
      body.scope === "agent"
        ? (body.agentId ?? thread?.agentId ?? store.listAgents()[0]?.id)
        : body.agentId;
    const fact = await store.proposeMemory(
      {
        ...body,
        ...(agentId ? { agentId } : {}),
      },
      {
        type: "manual",
        ...(body.threadId ? { threadId: body.threadId } : {}),
      },
    );
    if (body.threadId) {
      await store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type: "memory.proposed",
        category: "memory",
        visibility: "user",
        payload: {
          memoryId: fact.id,
          content: fact.content,
          category: fact.category,
          confidence: fact.confidence,
          scope: fact.scope,
          reviewIntervalDays: fact.reviewIntervalDays,
          ...(fact.agentId ? { agentId: fact.agentId } : {}),
          ...(fact.supersedesMemoryId
            ? { supersedesMemoryId: fact.supersedesMemoryId }
            : {}),
          ...(fact.consolidatesMemoryIds
            ? { consolidatesMemoryIds: fact.consolidatesMemoryIds }
            : {}),
        },
      });
    }
    setMemoryProjectionHeaders(context, fact);
    return context.json(fact, 201);
  });

  app.post("/api/memories/:memoryId/review", async (context) => {
    let input: unknown;
    try {
      input = await readLimitedJson(
        context.req.raw,
        MAX_MEMORY_REQUEST_BYTES,
        "Memory review request",
      );
    } catch (error) {
      return jsonError(
        context,
        errorMessage(error),
        error instanceof RequestBodyTooLargeError ? 413 : 400,
      );
    }
    const body = parseReviewMemoryRequest(input);
    if (!body) {
      return jsonError(context, "Memory review request is invalid", 400);
    }
    if (body.threadId) store.getThread(body.threadId);
    const fact = await store.reviewMemory(context.req.param("memoryId"), body);
    if (body.threadId) {
      await store.appendEvent({
        threadId: body.threadId,
        runId: createId("runctl"),
        type: memoryReviewEventType(body.action),
        category: "memory",
        visibility: "user",
        payload: {
          memoryId: fact.id,
          status: fact.status,
          content: fact.content,
          reviewIntervalDays: fact.reviewIntervalDays,
          reviewDueAt: fact.reviewDueAt ?? "",
          useCount: fact.useCount,
          ...(fact.supersedesMemoryId
            ? {
                supersedesMemoryId: fact.supersedesMemoryId,
                ...(body.action === "approve"
                  ? { supersededMemoryStatus: "archived" }
                  : {}),
              }
            : {}),
          ...(fact.consolidatesMemoryIds
            ? {
                consolidatesMemoryIds: fact.consolidatesMemoryIds,
                ...(body.action === "approve"
                  ? { consolidatedMemoryStatus: "archived" }
                  : {}),
              }
            : {}),
          ...(fact.supersededByMemoryId
            ? { supersededByMemoryId: fact.supersededByMemoryId }
            : {}),
          ...(fact.reviewNote ? { note: fact.reviewNote } : {}),
        },
      });
    }
    setMemoryProjectionHeaders(context, fact);
    return context.json(fact);
  });
}

function parseCreateMemoryRequest(
  input: unknown,
): CreateMemoryRequest | undefined {
  const record = requestRecord(input, [
    "content",
    "category",
    "scope",
    "agentId",
    "confidence",
    "reviewIntervalDays",
    "supersedesMemoryId",
    "consolidatesMemoryIds",
    "threadId",
  ]);
  const content = normalizeBoundedText(record?.["content"], 1, 2_000);
  const category =
    record?.["category"] === undefined
      ? undefined
      : parseMemoryCategory(record["category"]);
  const scope =
    record?.["scope"] === undefined
      ? undefined
      : parseMemoryScope(record["scope"]);
  const agentId = record?.["agentId"];
  const threadId = record?.["threadId"];
  const confidence = record?.["confidence"];
  const reviewIntervalDays = record?.["reviewIntervalDays"];
  const supersedesMemoryId = record?.["supersedesMemoryId"];
  const consolidatesMemoryIds =
    record?.["consolidatesMemoryIds"] === undefined
      ? undefined
      : parseMemoryIdArray(record["consolidatesMemoryIds"], 2, 8);
  if (
    !record ||
    !content ||
    (record["category"] !== undefined && !category) ||
    (record["scope"] !== undefined && !scope) ||
    (agentId !== undefined && !validAgentId(agentId)) ||
    (threadId !== undefined && !validThreadId(threadId)) ||
    (confidence !== undefined &&
      (typeof confidence !== "number" ||
        !Number.isFinite(confidence) ||
        confidence < 0 ||
        confidence > 1)) ||
    (reviewIntervalDays !== undefined &&
      (typeof reviewIntervalDays !== "number" ||
        !Number.isInteger(reviewIntervalDays) ||
        reviewIntervalDays < 1 ||
        reviewIntervalDays > 3_650)) ||
    (supersedesMemoryId !== undefined && !validMemoryId(supersedesMemoryId)) ||
    (record["consolidatesMemoryIds"] !== undefined && !consolidatesMemoryIds) ||
    (supersedesMemoryId !== undefined &&
      record["consolidatesMemoryIds"] !== undefined)
  ) {
    return undefined;
  }
  return {
    content,
    ...(category ? { category } : {}),
    ...(scope ? { scope } : {}),
    ...(typeof agentId === "string" ? { agentId } : {}),
    ...(typeof confidence === "number" ? { confidence } : {}),
    ...(typeof reviewIntervalDays === "number" ? { reviewIntervalDays } : {}),
    ...(typeof supersedesMemoryId === "string" ? { supersedesMemoryId } : {}),
    ...(consolidatesMemoryIds ? { consolidatesMemoryIds } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseReviewMemoryRequest(
  input: unknown,
): ReviewMemoryRequest | undefined {
  const record = requestRecord(input, ["action", "note", "threadId"]);
  const action = parseMemoryReviewAction(record?.["action"]);
  const threadId = record?.["threadId"];
  const note = parseOptionalBoundedText(record?.["note"], 500);
  if (
    !record ||
    !action ||
    (record["note"] !== undefined && note === undefined) ||
    (threadId !== undefined && !validThreadId(threadId))
  ) {
    return undefined;
  }
  return {
    action,
    ...(note ? { note } : {}),
    ...(typeof threadId === "string" ? { threadId } : {}),
  };
}

function parseMemoryCategory(
  input: unknown,
): NonNullable<CreateMemoryRequest["category"]> | undefined {
  return input === "preference" ||
    input === "context" ||
    input === "goal" ||
    input === "constraint" ||
    input === "decision" ||
    input === "identity" ||
    input === "behavior" ||
    input === "correction" ||
    input === "other"
    ? input
    : undefined;
}

function parseMemoryScope(
  input: unknown,
): NonNullable<CreateMemoryRequest["scope"]> | undefined {
  return input === "workspace" || input === "agent" ? input : undefined;
}

function parseMemoryReviewAction(
  input: unknown,
): ReviewMemoryRequest["action"] | undefined {
  return input === "approve" ||
    input === "reject" ||
    input === "archive" ||
    input === "restore" ||
    input === "refresh" ||
    input === "mark_stale"
    ? input
    : undefined;
}

function parseMemoryIdArray(
  input: unknown,
  minItems: number,
  maxItems: number,
): string[] | undefined {
  if (
    !Array.isArray(input) ||
    input.length < minItems ||
    input.length > maxItems ||
    !input.every((value) => validMemoryId(value))
  ) {
    return undefined;
  }
  const unique = new Set(input);
  return unique.size === input.length ? [...unique].sort() : undefined;
}

function requestRecord(
  input: unknown,
  supportedKeys: string[],
): Record<string, unknown> | undefined {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return undefined;
  }
  const record = input as Record<string, unknown>;
  return Object.keys(record).every((key) => supportedKeys.includes(key))
    ? record
    : undefined;
}

function normalizeBoundedText(
  input: unknown,
  minLength: number,
  maxLength: number,
): string | undefined {
  if (typeof input !== "string") return undefined;
  const normalized = input.replace(/\s+/g, " ").trim();
  return normalized.length >= minLength && normalized.length <= maxLength
    ? normalized
    : undefined;
}

function parseOptionalBoundedText(
  input: unknown,
  maxLength: number,
): string | undefined {
  if (input === undefined) return "";
  return normalizeBoundedText(input, 1, maxLength);
}

function validThreadId(value: unknown): value is string {
  return typeof value === "string" && /^thread_[a-z0-9]{8,80}$/.test(value);
}

function validAgentId(value: unknown): value is string {
  return typeof value === "string" && /^agent_[a-z0-9_]{2,80}$/.test(value);
}

function validMemoryId(value: unknown): value is string {
  return typeof value === "string" && /^memory_[a-z0-9]{8,80}$/.test(value);
}

function memoryReviewEventType(
  action: ReviewMemoryRequest["action"],
): RegisteredRunEventTypeForCategory<"memory"> {
  return (
    {
      approve: "memory.approved",
      reject: "memory.rejected",
      archive: "memory.archived",
      restore: "memory.restored",
      refresh: "memory.refreshed",
      mark_stale: "memory.stale",
    } as const
  )[action];
}

function setMemoryListHeaders(
  context: Context,
  memories: readonly MemoryFact[],
  agentId: string | undefined,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, memories);
  if (agentId) context.header("X-Napier-Agent-Id", agentId);
  context.header("X-Napier-Memory-Count", String(memories.length));
  for (const status of [
    "proposed",
    "active",
    "stale",
    "rejected",
    "archived",
  ] satisfies MemoryFact["status"][]) {
    context.header(
      `X-Napier-Memory-${status[0]!.toUpperCase()}${status.slice(1)}-Count`,
      String(memories.filter((memory) => memory.status === status).length),
    );
  }
}

function setMemoryProjectionHeaders(
  context: Context,
  memory: MemoryFact,
): void {
  context.header("Cache-Control", "no-store");
  setBodyContentSha256Header(context, memory);
  context.header("X-Napier-Memory-Id", memory.id);
  context.header("X-Napier-Memory-Status", memory.status);
  context.header("X-Napier-Memory-Revision", String(memory.revision));
  context.header("X-Napier-Memory-Scope", memory.scope);
  context.header("X-Napier-Memory-Category", memory.category);
  context.header(
    "X-Napier-Memory-Review-Interval-Days",
    String(memory.reviewIntervalDays),
  );
  context.header("X-Napier-Memory-Use-Count", String(memory.useCount));
  if (memory.agentId) context.header("X-Napier-Agent-Id", memory.agentId);
  if (memory.reviewDueAt) {
    context.header("X-Napier-Memory-Review-Due-At", memory.reviewDueAt);
  }
  if (memory.supersedesMemoryId) {
    context.header("X-Napier-Memory-Supersedes-Id", memory.supersedesMemoryId);
  }
  if (memory.supersededByMemoryId) {
    context.header(
      "X-Napier-Memory-Superseded-By-Id",
      memory.supersededByMemoryId,
    );
  }
  if (memory.consolidatesMemoryIds) {
    context.header(
      "X-Napier-Memory-Consolidates-Count",
      String(memory.consolidatesMemoryIds.length),
    );
  }
}
