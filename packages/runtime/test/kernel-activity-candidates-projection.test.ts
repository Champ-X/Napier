import type { RunEvent, ThreadRecord } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { ConversationActivityCandidatesProjectionService } from "../src/kernel-activity-candidates-projection.js";
import { KernelProjectionRegistry } from "../src/kernel-projections.js";

describe("Kernel Activity Candidates projection", () => {
  it("reuses a warm watermark and applies one candidate tail", async () => {
    const registry = new KernelProjectionRegistry();
    const thread = projectionThread();
    const events = [event(1, "run.started")];
    thread.eventCount = 1;
    const service = new ConversationActivityCandidatesProjectionService(
      registry,
      {
        getThread: () => structuredClone(thread),
        listEvents: async (_threadId, afterSeq = 0) =>
          events.filter((eventRecord) => eventRecord.seq > afterSeq),
      },
    );

    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: false,
        appliedEventCount: 1,
        view: [expect.objectContaining({ type: "run.started", seq: 1 })],
      }),
    );
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({ cacheHit: true, appliedEventCount: 0 }),
    );

    events.push(event(2, "run.no_progress"));
    thread.eventCount = 2;
    await expect(service.project(thread.id)).resolves.toEqual(
      expect.objectContaining({
        cacheHit: true,
        appliedEventCount: 1,
        view: [
          expect.objectContaining({ type: "run.started", seq: 1 }),
          expect.objectContaining({ type: "run.no_progress", seq: 2 }),
        ],
      }),
    );
  });
});

function projectionThread(): ThreadRecord {
  return {
    id: "thread_activity",
    title: "Activity projection",
    agentId: "agent_activity",
    status: "running",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
    lastMessage: "",
    eventCount: 0,
    runIds: ["run_activity"],
  };
}

function event(seq: number, type: string): RunEvent {
  return {
    id: `event_${String(seq)}`,
    threadId: "thread_activity",
    runId: "run_activity",
    seq,
    type,
    category: "lifecycle",
    visibility: "user",
    createdAt: `2026-08-16T00:00:0${String(seq)}.000Z`,
    payload: {},
  };
}
