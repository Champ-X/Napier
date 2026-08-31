import type {
  CreateBranchRequest,
  RegisteredRunEventInput,
  RunRecord,
  ThreadDetail,
} from "@napier/contracts";

import { createProcessLeaseOwnerId } from "./ids.js";
import type { LocalStore } from "./store.js";

const MAX_BRANCH_TITLE_CHARS = 100;

export class ThreadBranchRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ThreadBranchRequestError";
  }
}

export interface ThreadBranchResult {
  sourceThreadId: string;
  sourceSeq: number;
  run: RunRecord;
  detail: ThreadDetail;
}

export interface ThreadBranchOptions {
  includeGoalContinuationPrompts?: boolean;
}

type ThreadBranchStore = Pick<
  LocalStore,
  | "appendEvent"
  | "createLeasedRun"
  | "createThread"
  | "finishRun"
  | "getDetail"
  | "getThread"
  | "listEvents"
>;

export async function createThreadBranch(
  store: ThreadBranchStore,
  sourceThreadId: string,
  request: CreateBranchRequest,
  options: ThreadBranchOptions = {},
): Promise<ThreadBranchResult> {
  if (!Number.isSafeInteger(request.fromSeq) || request.fromSeq < 1) {
    throw new ThreadBranchRequestError("Thread branch sequence is invalid");
  }
  const source = store.getThread(sourceThreadId);
  if (request.fromSeq > source.eventCount) {
    throw new ThreadBranchRequestError(
      "Thread branch sequence exceeds the source Ledger",
    );
  }
  const title =
    request.title === undefined
      ? defaultBranchTitle(source.title)
      : normalizeBranchTitle(request.title);
  const sourceEvents = (await store.listEvents(sourceThreadId)).filter(
    (event) => event.seq <= request.fromSeq,
  );
  if (sourceEvents.at(-1)?.seq !== request.fromSeq) {
    throw new ThreadBranchRequestError(
      "Thread branch sequence is not present in the source Ledger",
    );
  }
  const sourceRunIds = new Set(source.runIds);
  const parentRunId = sourceEvents.findLast((event) =>
    sourceRunIds.has(event.runId),
  )?.runId;
  const messageEvents = sourceEvents.filter(
    (event) =>
      event.type === "message.user" ||
      event.type === "message.assistant" ||
      (options.includeGoalContinuationPrompts === true &&
        event.type === "goal.continuation.prompt"),
  );
  const branch = await store.createThread({
    title,
    agentId: source.agentId,
    ...(source.importProvenance
      ? {
          importProvenance: {
            ...source.importProvenance,
            localImportedThroughSeq: messageEvents.length + 1,
          },
        }
      : {}),
  });
  const lease = await store.createLeasedRun(
    {
      threadId: branch.id,
      agentId: source.agentId,
      ...(parentRunId ? { parentRunId } : {}),
      branchFromSeq: request.fromSeq,
    },
    {
      ownerId: createProcessLeaseOwnerId("branch"),
      ttlMs: 10 * 60_000,
    },
  );
  try {
    await store.appendEvent({
      threadId: branch.id,
      runId: lease.run.id,
      type: "branch.created",
      category: "lifecycle",
      visibility: "user",
      payload: {
        sourceThreadId,
        sourceSeq: request.fromSeq,
      },
    });
    for (const event of messageEvents) {
      const copied = branchMessageEvent(event);
      await store.appendEvent({
        threadId: branch.id,
        runId: lease.run.id,
        ...copied,
      });
    }
    const run = await store.finishRun(lease.run.id, "completed", {
      leaseToken: lease.token,
    });
    return {
      sourceThreadId,
      sourceSeq: request.fromSeq,
      run,
      detail: await store.getDetail(branch.id),
    };
  } catch (error) {
    await store
      .finishRun(lease.run.id, "failed", {
        error: "Thread branch creation failed",
        leaseToken: lease.token,
      })
      .catch(() => undefined);
    throw error;
  }
}

function branchMessageEvent(
  event: ThreadDetail["events"][number],
):
  | Extract<RegisteredRunEventInput, { type: "message.user" }>
  | Extract<RegisteredRunEventInput, { type: "message.assistant" }>
  | Extract<RegisteredRunEventInput, { type: "goal.continuation.prompt" }> {
  if (event.type === "message.user") {
    if (
      !event.payload ||
      Array.isArray(event.payload) ||
      typeof event.payload !== "object" ||
      event.payload["role"] !== "user" ||
      typeof event.payload["text"] !== "string"
    ) {
      throw new ThreadBranchRequestError("Source user message is invalid");
    }
    return {
      type: event.type,
      category: "message",
      visibility: event.visibility,
      payload: { ...event.payload, role: "user", text: event.payload["text"] },
    };
  }
  if (event.type === "message.assistant") {
    if (
      !event.payload ||
      Array.isArray(event.payload) ||
      typeof event.payload !== "object" ||
      event.payload["role"] !== "assistant" ||
      typeof event.payload["text"] !== "string"
    ) {
      throw new ThreadBranchRequestError("Source assistant message is invalid");
    }
    return {
      type: event.type,
      category: "message",
      visibility: event.visibility,
      payload: {
        ...event.payload,
        role: "assistant",
        text: event.payload["text"],
      },
    };
  }
  if (event.type === "goal.continuation.prompt") {
    if (
      !event.payload ||
      Array.isArray(event.payload) ||
      typeof event.payload !== "object"
    ) {
      throw new ThreadBranchRequestError("Source goal prompt is invalid");
    }
    return {
      type: event.type,
      category: "goal",
      visibility: event.visibility,
      payload: event.payload,
    };
  }
  throw new ThreadBranchRequestError("Source branch event is not copyable");
}

function normalizeBranchTitle(value: string): string {
  const normalized = value.replace(/\s+/gu, " ").trim();
  if (!normalized || normalized.length > MAX_BRANCH_TITLE_CHARS) {
    throw new ThreadBranchRequestError(
      `Thread branch title must be 1-${MAX_BRANCH_TITLE_CHARS} characters`,
    );
  }
  return normalized;
}

function defaultBranchTitle(sourceTitle: string): string {
  return `${sourceTitle} / branch`
    .replace(/\s+/gu, " ")
    .trim()
    .slice(0, MAX_BRANCH_TITLE_CHARS);
}
