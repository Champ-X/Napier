import { createHash } from "node:crypto";

const hash = (value) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");

/** Fixture setup only: no assistant messages, tool results or paid model work. */
export function parseBranchHistoryFixture(text) {
  const value = JSON.parse(text);
  const keys = [
    "schemaVersion",
    "initialText",
    "mode",
    "amendmentText",
    "sourceLaterText",
  ];
  if (
    !value ||
    Array.isArray(value) ||
    Object.keys(value).some((key) => !keys.includes(key)) ||
    value.schemaVersion !== 1 ||
    !["steering", "follow_up"].includes(value.mode) ||
    ["initialText", "amendmentText", "sourceLaterText"].some(
      (key) =>
        typeof value[key] !== "string" ||
        !value[key].trim() ||
        value[key].length > 8000,
    )
  )
    throw new Error("Invalid branch history fixture");
  return value;
}

export async function seedBranchHistory({
  store,
  thread,
  fixture,
  createThreadBranch,
}) {
  const source = await store.createRun({
    threadId: thread.id,
    agentId: thread.agentId,
    model: {
      provider: "branch-history-fixture",
      id: "synthetic-no-invocation",
    },
  });
  const appendUser = (runId, text) =>
    store.appendEvent({
      threadId: thread.id,
      runId,
      type: "message.user",
      category: "message",
      visibility: "user",
      payload: { role: "user", text },
    });
  await appendUser(source.id, fixture.initialText);
  await store.queueRunControlMessage({
    threadId: thread.id,
    runId: source.id,
    mode: fixture.mode,
    text: fixture.amendmentText,
  });
  await store.deliverNextRunControlMessage(thread.id, source.id, fixture.mode);
  await store.finishRun(source.id, "completed");
  const amendment = (await store.listRunEvents(source.id)).findLast(
    (event) => event.type === "message.user",
  );
  if (amendment?.payload.controlMode !== fixture.mode)
    throw new Error("Fixture control was not delivered");
  const branch = await createThreadBranch(store, thread.id, {
    fromSeq: amendment.seq,
  });
  const later = await store.createRun({
    threadId: thread.id,
    agentId: thread.agentId,
  });
  await appendUser(later.id, fixture.sourceLaterText);
  await store.finishRun(later.id, "completed");
  const sourceEvents = await store.listEvents(thread.id);
  const branchEvents = await store.listRunEvents(branch.run.id);
  const copied = branchEvents.findLast(
    (event) => event.type === "message.user",
  );
  return {
    thread: store.getThread(branch.run.threadId),
    receipt: {
      kind: "napier.branch-history-component",
      schemaVersion: 1,
      fixtureSetup:
        "Synthetic user/control history through LocalStore and createThreadBranch; no prior model success",
      sourceThreadId: thread.id,
      sourceRunIds: [source.id, later.id],
      sourceSeq: amendment.seq,
      branchRunId: branch.run.id,
      branchEventId: branchEvents[0].id,
      copiedAmendmentEventId: copied.id,
      copiedUserEventIds: branchEvents
        .filter((event) => event.type === "message.user")
        .map((event) => event.id),
      sourceUserEventIds: sourceEvents
        .filter((event) => event.type === "message.user")
        .map((event) => event.id),
      sourceEventsSha256: hash(sourceEvents),
      branchEventsSha256: hash(branchEvents),
    },
  };
}

export async function auditBranchHistory(store, receipt, events) {
  const memories = events.filter(
    (event) =>
      event.type === "context.memory" &&
      event.payload.phase === "model_invocation",
  );
  const queries = memories.map((event) => event.payload.query);
  const inheritedQueries =
    queries.length > 0 &&
    queries.every(
      (query) =>
        receipt.copiedUserEventIds.every((id) =>
          query?.sourceEventIds?.includes(id),
        ) &&
        !receipt.sourceUserEventIds.some((id) =>
          query?.sourceEventIds?.includes(id),
        ) &&
        query?.branchCopies?.some(
          (copy) =>
            copy.eventId === receipt.copiedAmendmentEventId &&
            copy.branchEventId === receipt.branchEventId &&
            copy.sourceThreadId === receipt.sourceThreadId &&
            copy.sourceSeq === receipt.sourceSeq,
        ),
    );
  const sourceUnchanged =
    hash(await store.listEvents(receipt.sourceThreadId)) ===
    receipt.sourceEventsSha256;
  const branchUnchanged =
    hash(await store.listRunEvents(receipt.branchRunId)) ===
    receipt.branchEventsSha256;
  return {
    ...receipt,
    sourceUnchanged,
    branchUnchanged,
    inheritedQueries,
    queryReceipts: queries.length,
    passed: sourceUnchanged && branchUnchanged && inheritedQueries,
  };
}
