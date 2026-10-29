import path from "node:path";
import type { SubagentMessage } from "@napier/contracts/subagent-supervisor";
import { afterEach, describe, expect, it, vi } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { InProcessSubagentProvider } from "../src/in-process-subagent-provider.js";
import { durableTerminalRunStatus, RUN_TERMINAL_EVENT_TYPES } from "../src/run-event-admission.js";
import { LEDGER_DATABASE_FILENAME, SqliteLedger } from "../src/sqlite-ledger.js";
import type { SubagentChildRunHost } from "../src/subagent-child-run-host.js";
import { continuationMailbox } from "../src/subagent-continuation-mailbox.js";
import {
  listAcceptedSubagentMailboxEvents,
  listSubagentMailboxAdmissionEvents,
  listThreadSubagentMailboxEvents,
} from "../src/subagent-mailbox-events.js";
import { projectSubagentMailbox } from "../src/subagent-mailbox-projection.js";
import { acceptedSubagentMailbox, validateConsumedSubagentMailbox } from "../src/subagent-mailbox-state.js";
import { ToolConcurrencyGate } from "../src/tool-concurrency-gate.js";
import { cleanupContinuationRunnerFixtures, continuationRunnerFixture } from "./subagent-continuation-runner-fixture.js";

const children: Array<{ dispose(): void }> = [];
afterEach(async () => {
  vi.restoreAllMocks();
  for (const child of children.splice(0)) child.dispose();
  await cleanupContinuationRunnerFixtures();
});

async function fixture() {
  const f = await continuationRunnerFixture();
  children.push(f.child);
  return f;
}

function message(taskId: string, id: string, text: string): SubagentMessage {
  const content = { kind: "napier.subagent-message" as const, schemaVersion: 1 as const, id, taskId,
    messageKind: "steering" as const, text, createdAt: "2026-10-30T00:00:00.000Z" };
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}

describe("typed subagent mailbox queries", () => {
  it("preserves first accepted sequence binding when a reader returns colliding unfiltered rows", async () => {
    const f = await fixture();
    const accepted = await f.accept("Original sequence binding");
    const original = (await f.sourceStore.listRunEvents(f.parent.run.id))
      .find((event) => event.type === "subagent.message.accepted")!;
    const foreign = { ...original, id: "event_foreign_collision",
      payload: JSON.parse(canonicalJson(message("task_foreign", accepted.id, "Foreign sequence binding"))) };
    const noise = { ...original, id: "event_noise_collision", type: "subagent.step" };
    let rows = [noise, original, foreign];
    const host = { state: { subagents: [f.task], runs: [f.child.run] },
      requireLedger: () => ({ listRunEvents: () => rows }) } as unknown as SubagentChildRunHost;
    const result = continuationMailbox(host, f.child.run, f.task);
    expect([...result.messages.values()]).toEqual([accepted]);
    expect(result.accepted).toEqual(acceptedSubagentMailbox(rows, f.task));
    rows = [noise, foreign, original];
    expect(() => continuationMailbox(host, f.child.run, f.task)).toThrow("message binding is invalid");
  });

  it("preserves Run-wide identity conflicts across sibling Tasks and the full acceptance replay", async () => {
    const f = await fixture();
    const accepted = await f.accept("First task requirement");
    const sibling = await f.sourceStore.createSubagentTask({ threadId: f.thread.id, runId: f.parent.run.id,
      role: "researcher", description: "Sibling", prompt: "Sibling requirement", model: f.profile.model,
      providerId: "in_process", executionId: "subexec_mailbox_sibling" });
    await expect(f.sourceStore.acceptSubagentMessage({ taskId: sibling.id, executionId: sibling.executionId!,
      message: message(sibling.id, accepted.id, accepted.text) })).rejects.toThrow("message conflicts");
    const siblingMessage = message(sibling.id, "submsg_siblingunique", "Sibling's own requirement");
    await f.sourceStore.acceptSubagentMessage({ taskId: sibling.id, executionId: sibling.executionId!, message: siblingMessage });
    await f.sourceStore.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id,
      type: "subagent.step", category: "subagent", payload: { taskId: f.task.id, kind: "reasoning" } });

    const ledger = new SqliteLedger(path.join(f.dataRoot, LEDGER_DATABASE_FILENAME));
    ledger.initialize();
    try {
      const full = ledger.listRunEvents(f.parent.run.id);
      const query = vi.spyOn(ledger, "listRunEvents");
      const selected = listAcceptedSubagentMailboxEvents(ledger, f.parent.run.id);
      expect(query).toHaveBeenCalledWith(f.parent.run.id, 0, ["subagent.message.accepted"]);
      expect(selected).toEqual(full.filter((event) => event.type === "subagent.message.accepted"));
      expect(selected.map((event) => {
        const payload = event.payload;
        return payload && typeof payload === "object" && !Array.isArray(payload) ? payload["id"] : undefined;
      })).toEqual([accepted.id, siblingMessage.id]);
      expect(acceptedSubagentMailbox(selected, f.task)).toEqual(acceptedSubagentMailbox(full, f.task));
      expect(acceptedSubagentMailbox(selected, sibling)).toEqual(acceptedSubagentMailbox(full, sibling));
    } finally { ledger.close(); }
  });

  it.each(["completed", "failed", "cancelled", "interrupted"] as const)(
    "replays identical acceptance before rejecting new input after parent %s", async (status) => {
      const f = await fixture();
      const prior = await f.accept("Durable acceptance before termination");
      const input = { taskId: f.task.id, executionId: f.task.executionId!, message: prior };
      const receipt = await f.sourceStore.acceptSubagentMessage(input);
      await f.sourceStore.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id,
        type: `run.${status}`, category: "lifecycle", payload: {} });
      expect(await f.sourceStore.acceptSubagentMessage(input)).toMatchObject({ appended: false, event: { id: receipt.event.id } });
      await expect(f.sourceStore.acceptSubagentMessage({ ...input,
        message: message(f.task.id, "submsg_afterterminal", "New input after termination") })).rejects.toThrow("not accepting");
      await f.sourceStore.finishRun(f.parent.run.id, status, { leaseToken: f.parent.token });
      expect(await f.sourceStore.acceptSubagentMessage(input)).toMatchObject({ appended: false, event: { id: receipt.event.id } });

      const ledger = new SqliteLedger(path.join(f.dataRoot, LEDGER_DATABASE_FILENAME));
      ledger.initialize();
      try {
        const full = ledger.listRunEvents(f.parent.run.id);
        const selected = listSubagentMailboxAdmissionEvents(ledger, f.parent.run.id);
        expect(selected).toEqual(full.filter((event) => event.type === "subagent.message.accepted" ||
          RUN_TERMINAL_EVENT_TYPES.includes(event.type as typeof RUN_TERMINAL_EVENT_TYPES[number])));
        expect(durableTerminalRunStatus(selected, f.thread.id, f.parent.run.id)).toBe(status);
        expect(durableTerminalRunStatus(selected, f.thread.id, f.parent.run.id))
          .toBe(durableTerminalRunStatus(full, f.thread.id, f.parent.run.id));
      } finally { ledger.close(); }
    },
  );

  it("keeps inspect thread-scoped and deduplicates relevant delivery from another Run", async () => {
    const f = await fixture();
    const accepted = await f.accept("Visible logical mailbox requirement");
    const delivery = { taskId: f.task.id, messageId: accepted.id,
      messageKind: accepted.messageKind, contentSha256: accepted.contentSha256 };
    await f.sourceStore.appendEvent({ threadId: f.thread.id, runId: f.child.run.id,
      type: "subagent.message.delivered", category: "subagent", payload: delivery });
    const crossRunDelivery = await f.sourceStore.appendEvent({ threadId: f.thread.id, runId: f.child.run.id,
      type: "subagent.message.delivered", category: "subagent", payload: delivery });
    await f.sourceStore.appendEvent({ threadId: f.thread.id, runId: f.child.run.id,
      type: "subagent.message.delivered", category: "subagent", payload: { ...delivery, messageId: "submsg_unknownid" } });
    await f.sourceStore.appendEvent({ threadId: f.thread.id, runId: f.parent.run.id,
      type: "subagent.step", category: "subagent", payload: { taskId: f.task.id, kind: "reasoning" } });
    const full = await f.sourceStore.listEvents(f.thread.id);
    const tasks = f.sourceStore.listSubagentTasks(f.thread.id);
    const expected = projectSubagentMailbox(f.task, tasks, full);
    const rangeQuery = vi.spyOn(f.sourceStore, "listEventsRange");
    const fullQuery = vi.spyOn(f.sourceStore, "listEvents");
    const selected = await listThreadSubagentMailboxEvents(f.sourceStore, f.thread.id);
    expect(selected).toEqual(full.filter((event) =>
      event.type === "subagent.message.accepted" || event.type === "subagent.message.delivered"));
    const provider = new InProcessSubagentProvider({ store: f.sourceStore, models: f.registry.models,
      defaultModel: f.model, profile: f.profile, run: f.parent.run, limits: f.profile.subagentLimits!,
      parentSignal: new AbortController().signal, concurrencyGate: new ToolConcurrencyGate() });
    const inspected = await provider.inspect({ kind: "napier.subagent-handle", schemaVersion: 1,
      providerId: "in_process", taskId: f.task.id, executionId: f.task.executionId! });
    expect(inspected.mailbox).toEqual(expected);
    expect(inspected.mailbox).toMatchObject({ acceptedCount: 1, deliveredCount: 1, pendingCount: 0,
      consumedCount: 0, pendingConsumptionCount: 1, lastDeliveredAt: crossRunDelivery.createdAt });
    expect(rangeQuery).toHaveBeenCalledWith(f.thread.id, 1, Number.MAX_SAFE_INTEGER,
      ["subagent.message.accepted", "subagent.message.delivered"]);
    expect(fullQuery).not.toHaveBeenCalled();
  });

  it("retains sparse inherited consumption and the all-event child frontier after native continuation", async () => {
    const f = await fixture();
    const a = await f.accept("Pending predecessor message A");
    const b = await f.accept("Consumed predecessor message B", true);
    const resumed = await f.interruptAndClaim();
    const execution = resumed.continuation.execution;
    const fence = { runId: execution.run.id, taskId: execution.task.id,
      executionId: execution.task.executionId!, token: execution.token,
      expectedExecutionRevision: execution.executionRevision };
    const prepared = await resumed.store.prepareSubagentChildCheckpoint(fence);
    expect(prepared.mailbox.accepted.map((entry) => entry.id)).toEqual([a.id, b.id]);
    expect(prepared.mailbox.accepted).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: a.id, originTaskId: f.task.id, originParentRunId: f.parent.run.id }),
      expect.objectContaining({ id: b.id, originTaskId: f.task.id, originParentRunId: f.parent.run.id }),
    ]));
    expect(prepared.mailbox.consumed).toEqual([expect.objectContaining({ id: b.id,
      originTaskId: f.task.id, originParentRunId: f.parent.run.id })]);
    expect(prepared.mailbox.consumedThroughSeq).toBe(0);
    expect(validateConsumedSubagentMailbox(prepared.mailbox.accepted, prepared.mailbox.consumed, [])).toBe(0);
    expect(validateConsumedSubagentMailbox(prepared.mailbox.accepted,
      [...prepared.mailbox.consumed, { ...prepared.mailbox.accepted[0]!, messageIndex: 2 }], prepared.mailbox.consumed))
      .toBe(prepared.mailbox.accepted[1]!.acceptedSeq);
    const full = await resumed.store.listEvents(f.thread.id);
    const selected = await listThreadSubagentMailboxEvents(resumed.store, f.thread.id);
    const tasks = resumed.store.listSubagentTasks(f.thread.id);
    const projected = projectSubagentMailbox(execution.task, tasks, selected);
    expect(projected).toEqual(projectSubagentMailbox(execution.task, tasks, full));
    expect(projected).toMatchObject({ acceptedCount: 2, consumedCount: 1, consumedThroughSeq: 0,
      pendingConsumptionCount: 1 });

    const laterChildEvent = await resumed.store.appendEvent({ threadId: f.thread.id, runId: execution.run.id,
      type: "subagent.message.delivered", category: "subagent", payload: { taskId: execution.task.id,
        messageId: a.id, messageKind: a.messageKind, contentSha256: a.contentSha256 } });
    const next = await resumed.store.prepareSubagentChildCheckpoint(fence);
    expect(next.frontier.runHeadSeq).toBe(laterChildEvent.seq);
    expect(next.frontier.runHeadSeq).toBeGreaterThan(prepared.frontier.runHeadSeq);
    expect(next.mailbox).toEqual(prepared.mailbox);
  });
});
