import type { RunEvent } from "@napier/contracts";
import { describe, expect, it } from "vitest";

import { DurableToolOperationJournal } from "../src/tool-operation-journal.js";
import {
  idempotentOperationDescriptor,
  memoryToolOperationStore,
  mutatingOperationDescriptor,
  toolOperationTestOwner as owner,
} from "./tool-operation-test-support.js";

describe("tool operation result settlement repair", () => {
  it("repairs only after the current started lease expires", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryToolOperationStore(persisted);
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const original = operation(store, "result-owner", () => now);
    await original.admit();
    await original.started();
    const evidence = await appendEvidence(store, "captured result");
    const recovery = operation(store, "repair-owner", () => now);
    const repair = () =>
      recovery.repairSettled({
        settlement: { outcome: "succeeded", state: "captured-result" },
        resultEvidenceSha256: "a".repeat(64),
        resultEvidenceEventSeq: evidence.seq,
      });

    await expect(repair()).resolves.toEqual({
      disposition: "in_flight_replay",
    });
    now += 100;
    await expect(repair()).resolves.toEqual({ disposition: "repaired" });
    await expect(
      original.settled({ outcome: "succeeded", state: "captured-result" }),
    ).rejects.toThrow("expired before settlement");
    await expect(recovery.admit()).resolves.toMatchObject({
      admitted: false,
      disposition: "terminal_replay",
    });
  });

  it("rejects evidence captured before start", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryToolOperationStore(persisted);
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const admitted = operation(store, "pre-start-owner", () => now);
    await admitted.admit();
    const evidence = await appendEvidence(store, "forged before start");
    now += 100;

    await expect(
      admitted.repairSettled({
        settlement: { outcome: "succeeded", state: "forged" },
        resultEvidenceSha256: "b".repeat(64),
        resultEvidenceEventSeq: evidence.seq,
      }),
    ).resolves.toEqual({ disposition: "not_repairable" });
  });

  it("rejects evidence belonging to an older started generation", async () => {
    const persisted: RunEvent[] = [];
    const store = memoryToolOperationStore(persisted);
    let now = Date.parse("2026-09-03T12:00:00.000Z");
    const first = idempotentOperation(store, "generation-one", () => now);
    await first.admit();
    await first.started();
    const oldEvidence = await appendEvidence(store, "generation one result");

    now += 100;
    const second = idempotentOperation(store, "generation-two", () => now);
    await second.admit();
    await second.started();
    now += 100;
    await expect(
      second.repairSettled({
        settlement: { outcome: "succeeded", state: "stale-result" },
        resultEvidenceSha256: "c".repeat(64),
        resultEvidenceEventSeq: oldEvidence.seq,
      }),
    ).resolves.toEqual({ disposition: "not_repairable" });
  });
});

function operation(
  store: ReturnType<typeof memoryToolOperationStore>,
  ownerId: string,
  now: () => number,
) {
  return new DurableToolOperationJournal(store, owner, {
    now,
    executionLease: { ownerId, durationMs: 100 },
  })
    .observer("call_result_repair")
    .operation(mutatingOperationDescriptor());
}

function idempotentOperation(
  store: ReturnType<typeof memoryToolOperationStore>,
  ownerId: string,
  now: () => number,
) {
  return new DurableToolOperationJournal(store, owner, {
    now,
    executionLease: { ownerId, durationMs: 100 },
  })
    .observer("call_generation_repair")
    .operation(idempotentOperationDescriptor());
}

function appendEvidence(
  store: ReturnType<typeof memoryToolOperationStore>,
  text: string,
): Promise<RunEvent> {
  return store.appendEvent({
    threadId: owner.threadId,
    runId: owner.runId,
    type: "message.user",
    category: "message",
    visibility: "user",
    payload: { role: "user", text },
  });
}
