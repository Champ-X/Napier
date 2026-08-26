import {
  RUN_EVENT_DEFINITION_GROUPS_V1,
  type JsonValue,
  type RunEvent,
  type ThreadRecord,
} from "@napier/contracts";
import { describe, expect, it, vi } from "vitest";

import {
  CONTEXT_READ_MODEL_EVENT_TYPES,
  ContextEventReadModel,
} from "../src/context-event-read-model.js";
import {
  contextContinuityEvidenceEvents,
  contextMessageEvents,
  createContextCheckpoint,
} from "../src/compaction.js";

describe("Context event read model", () => {
  it("loads a typed snapshot once and then only the new Thread range", async () => {
    const thread = createThread(3);
    const stored = [
      event(1, "message.user", "user"),
      event(2, "turn.started", "debug"),
      event(3, "message.assistant", "user"),
    ];
    const listEventsRange = vi.fn(
      async (
        _threadId: string,
        fromSeq: number,
        toSeq: number,
        types?: readonly string[],
      ) =>
        stored.filter(
          (item) =>
            item.seq >= fromSeq &&
            item.seq <= toSeq &&
            (!types || types.includes(item.type)),
        ),
    );
    const readModel = new ContextEventReadModel({
      getThread: () => structuredClone(thread),
      listEventsRange,
      findLatestEvent: async () => undefined,
    });

    const first = await readModel.read(thread.id);
    expect(first.map((item) => item.seq)).toEqual([1, 3]);
    expect(listEventsRange).toHaveBeenLastCalledWith(
      thread.id,
      1,
      3,
      CONTEXT_READ_MODEL_EVENT_TYPES,
    );

    (first[0]!.payload as { text: string }).text = "mutated";
    expect((await readModel.read(thread.id))[0]!.payload).toEqual({
      text: "1",
    });
    expect(listEventsRange).toHaveBeenCalledTimes(1);

    stored.push(
      event(4, "tool.completed", "user"),
      event(5, "turn.completed", "debug"),
    );
    thread.eventCount = 5;
    expect((await readModel.read(thread.id)).map((item) => item.seq)).toEqual([
      1, 3, 4,
    ]);
    expect(listEventsRange).toHaveBeenLastCalledWith(
      thread.id,
      4,
      5,
      CONTEXT_READ_MODEL_EVENT_TYPES,
    );
  });

  it("validates the newest checkpoint before caching incremental tail reads", async () => {
    const thread = createThread(4);
    const messages = [
      event(1, "message.user", "user"),
      event(2, "message.assistant", "user"),
    ];
    const checkpoint = createContextCheckpoint({
      checkpointId: "checkpoint_valid",
      compactEvents: messages,
      retainedFromSeq: 4,
      result: {
        summary: "The first exchange is verified.",
        decisions: [],
        openLoops: [],
        artifacts: [],
      },
    });
    const stored = [
      ...messages,
      event(3, "context.compaction.completed", "user", checkpoint),
      event(4, "message.user", "user"),
    ];
    const { readModel, findLatestEvent, listEventsRange } = harness(
      thread,
      stored,
    );

    expect((await readModel.read(thread.id)).map((item) => item.seq)).toEqual([
      1, 2, 3, 4,
    ]);
    expect(findLatestEvent).toHaveBeenCalledOnce();
    expect(listEventsRange).toHaveBeenCalledWith(
      thread.id,
      checkpoint.fromSeq,
      thread.eventCount,
      CONTEXT_READ_MODEL_EVENT_TYPES,
    );

    stored.push(event(5, "message.assistant", "user"));
    thread.eventCount = 5;
    expect((await readModel.read(thread.id)).map((item) => item.seq)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(findLatestEvent).toHaveBeenCalledOnce();
    expect(listEventsRange).toHaveBeenLastCalledWith(
      thread.id,
      5,
      5,
      CONTEXT_READ_MODEL_EVENT_TYPES,
    );
  });

  it("falls back past a corrupt latest checkpoint", async () => {
    const thread = createThread(5);
    const messages = [
      event(1, "message.user", "user"),
      event(2, "message.assistant", "user"),
    ];
    const checkpoint = createContextCheckpoint({
      checkpointId: "checkpoint_previous",
      compactEvents: messages,
      retainedFromSeq: 4,
      result: {
        summary: "The previous checkpoint remains valid.",
        decisions: [],
        openLoops: [],
        artifacts: [],
      },
    });
    const corrupt = {
      ...checkpoint,
      checkpointId: "checkpoint_corrupt",
      sourceSha256: "f".repeat(64),
    };
    const stored = [
      ...messages,
      event(3, "context.compaction.completed", "user", checkpoint),
      event(4, "message.user", "user"),
      event(5, "context.compaction.completed", "user", corrupt),
    ];
    const { readModel, findLatestEvent } = harness(thread, stored);

    expect((await readModel.read(thread.id)).map((item) => item.seq)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(findLatestEvent).toHaveBeenNthCalledWith(1, {
      threadId: thread.id,
      atOrBeforeSeq: thread.eventCount,
      types: ["context.compaction.completed"],
    });
    expect(findLatestEvent).toHaveBeenNthCalledWith(2, {
      threadId: thread.id,
      atOrBeforeSeq: 4,
      types: ["context.compaction.completed"],
    });
  });

  it("serializes concurrent refreshes and does not restore invalidated cache", async () => {
    const thread = createThread(1);
    const stored = [event(1, "message.user", "user")];
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const listEventsRange = vi.fn(async () => {
      await gate;
      return structuredClone(stored);
    });
    const readModel = new ContextEventReadModel({
      getThread: () => structuredClone(thread),
      listEventsRange,
      findLatestEvent: async () => undefined,
    });

    const first = readModel.read(thread.id);
    const concurrent = readModel.read(thread.id);
    await vi.waitFor(() => expect(listEventsRange).toHaveBeenCalledTimes(1));
    readModel.invalidate(thread.id);
    release();
    await expect(first).resolves.toHaveLength(1);
    await expect(concurrent).resolves.toHaveLength(1);
    expect(listEventsRange).toHaveBeenCalledTimes(2);

    await readModel.read(thread.id);
    expect(listEventsRange).toHaveBeenCalledTimes(2);
  });

  it("covers every registered message and continuity evidence type", () => {
    const candidates = RUN_EVENT_DEFINITION_GROUPS_V1.flatMap(
      (group) => group.types,
    ).map((type, index) => event(index + 1, type, "user"));
    const expected = [
      ...contextMessageEvents(candidates),
      ...contextContinuityEvidenceEvents(candidates),
    ];
    expect(
      expected.every((item) =>
        CONTEXT_READ_MODEL_EVENT_TYPES.includes(item.type as never),
      ),
    ).toBe(true);
    expect(CONTEXT_READ_MODEL_EVENT_TYPES).toEqual(
      expect.arrayContaining([
        "context.compaction.completed",
        "context.conversation_surface",
        "context.conversation_surface_unavailable",
        "context.model_invocation",
        "context.model_invocation_unavailable",
        "context.tool_invocation",
        "context.tool_invocation_unavailable",
        "context.tool_result",
        "context.tool_result_unavailable",
        "model.response",
      ]),
    );
  });
});

function createThread(eventCount: number): ThreadRecord {
  return {
    id: "thread_a",
    title: "Context read model",
    agentId: "agent_a",
    status: "idle",
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(eventCount * 1_000).toISOString(),
    lastMessage: "",
    eventCount,
    runIds: ["run_a"],
  };
}

function event(
  seq: number,
  type: string,
  visibility: RunEvent["visibility"],
  payload: JsonValue = { text: String(seq) },
): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_a",
    runId: "run_a",
    seq,
    type,
    category: type.startsWith("message.") ? "message" : "system",
    visibility,
    createdAt: new Date(seq * 1_000).toISOString(),
    payload,
  };
}

function harness(thread: ThreadRecord, stored: RunEvent[]) {
  const listEventsRange = vi.fn(
    async (
      _threadId: string,
      fromSeq: number,
      toSeq: number,
      types?: readonly string[],
    ) =>
      structuredClone(
        stored.filter(
          (item) =>
            item.seq >= fromSeq &&
            item.seq <= toSeq &&
            (!types || types.includes(item.type)),
        ),
      ),
  );
  const findLatestEvent = vi.fn(
    async (scope: {
      threadId?: string;
      atOrBeforeSeq?: number;
      types?: readonly string[];
    }) =>
      structuredClone(
        stored
          .filter(
            (item) =>
              (scope.threadId === undefined ||
                item.threadId === scope.threadId) &&
              (scope.atOrBeforeSeq === undefined ||
                item.seq <= scope.atOrBeforeSeq) &&
              (!scope.types || scope.types.includes(item.type)),
          )
          .at(-1),
      ),
  );
  return {
    readModel: new ContextEventReadModel({
      getThread: () => structuredClone(thread),
      listEventsRange,
      findLatestEvent,
    }),
    findLatestEvent,
    listEventsRange,
  };
}
