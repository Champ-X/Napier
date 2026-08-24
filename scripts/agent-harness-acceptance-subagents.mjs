import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";

import { createSubagentRestartSnapshot } from "../packages/runtime/dist/agent-harness-acceptance.js";
import { InProcessSubagentProvider } from "../packages/runtime/dist/in-process-subagent-provider.js";
import { ModelRouter } from "../packages/runtime/dist/model-route.js";
import { ModelRegistry } from "../packages/runtime/dist/models.js";
import { SubagentSupervisor } from "../packages/runtime/dist/subagent-supervisor.js";
import {
  addLedgerRun,
  createEvidenceStore,
  ledgerRun,
  reopenEvidenceStore,
} from "./agent-harness-acceptance-evidence-support.mjs";

const SUBAGENT_EVENTS = new Set([
  "subagent.message.accepted",
  "subagent.message.delivered",
  "subagent.cancel.requested",
  "subagent.completed",
  "subagent.failed",
  "subagent.cancelled",
  "subagent.timed_out",
  "subagent.orphaned",
]);

export async function collectSubagentEvidence(root, ledgerRuns) {
  let fixture = await createEvidenceStore(root, "subagents");
  const terminal = await terminalTasks(fixture.store);
  const steering = await steeringTask(fixture.store);
  const cancellation = await cancellationTask(fixture.store);
  fixture = await reopenEvidenceStore(fixture);
  try {
    const subagentTasks = await Promise.all(
      terminal.tasks.map(async (item) => {
        const task = fixture.store
          .listSubagentTasks(terminal.owner.thread.id, terminal.owner.run.id)
          .find((candidate) => candidate.id === item.taskId);
        if (!task)
          throw new Error(
            `Restarted Subagent task is unavailable: ${item.taskId}`,
          );
        const events = (
          await fixture.store.listEvents(terminal.owner.thread.id)
        ).filter((event) => event.runId === terminal.owner.run.id);
        const terminalEvent = events.find(
          (event) =>
            event.type === `subagent.${task.status}` &&
            event.payload?.taskId === task.id,
        );
        if (!terminalEvent)
          throw new Error(`Subagent terminal event is unavailable: ${task.id}`);
        return {
          taskId: task.id,
          terminalEventId: terminalEvent.id,
          runEvidenceSha256: addLedgerRun(
            ledgerRuns,
            await ledgerRun(
              fixture.store,
              terminal.owner.thread.id,
              terminal.owner.run.id,
              SUBAGENT_EVENTS,
            ),
          ),
          restartSnapshot: createSubagentRestartSnapshot(task),
        };
      }),
    );
    const steeringEvents = await selectedEvents(fixture.store, steering.owner);
    const accepted = steeringEvents.find(
      (event) =>
        event.type === "subagent.message.accepted" &&
        event.payload?.taskId === steering.taskId,
    );
    if (!accepted) throw new Error("Steering acceptance event is unavailable");
    const steeringBoundaryChecks = [
      {
        taskId: steering.taskId,
        messageId: accepted.payload.id,
        runEvidenceSha256: addLedgerRun(
          ledgerRuns,
          await ledgerRun(
            fixture.store,
            steering.owner.thread.id,
            steering.owner.run.id,
            SUBAGENT_EVENTS,
          ),
        ),
      },
    ];
    const cancellationEvents = await selectedEvents(
      fixture.store,
      cancellation.owner,
    );
    const requested = cancellationEvents.find(
      (event) =>
        event.type === "subagent.cancel.requested" &&
        event.payload?.taskId === cancellation.taskId,
    );
    const cancelled = cancellationEvents.find(
      (event) =>
        event.type === "subagent.cancelled" &&
        event.payload?.taskId === cancellation.taskId,
    );
    if (!requested || !cancelled)
      throw new Error("Cancellation boundary events are unavailable");
    const cancellationBoundaryChecks = [
      {
        taskId: cancellation.taskId,
        requestEventId: requested.id,
        terminalEventId: cancelled.id,
        runEvidenceSha256: addLedgerRun(
          ledgerRuns,
          await ledgerRun(
            fixture.store,
            cancellation.owner.thread.id,
            cancellation.owner.run.id,
            SUBAGENT_EVENTS,
          ),
        ),
      },
    ];
    return {
      subagentTasks,
      steeringBoundaryChecks,
      cancellationBoundaryChecks,
    };
  } finally {
    await fixture.store.shutdown();
  }
}

async function terminalTasks(store) {
  const owner = await createOwner(store, "Subagent durable terminals");
  const harness = createSupervisorHarness(store, owner, {
    providerId: "subagent-terminal",
    responses: Array.from({ length: 30 }, (_, index) =>
      fauxAssistantMessage(outcome(`Task ${String(index + 1)} completed.`)),
    ),
    maxTotal: 31,
  });
  const tasks = [];
  for (let index = 0; index < 30; index += 1) {
    const handle = await harness.supervisor.start(
      request(owner, `Terminal ${String(index + 1)}`),
    );
    const collected = await harness.supervisor.collect(handle);
    if (collected.status !== "completed") {
      throw new Error(`Subagent task did not complete: ${handle.taskId}`);
    }
    tasks.push({ taskId: handle.taskId });
  }
  await store.finishRun(owner.run.id, "completed", { outcome: "completed" });
  return { owner, tasks };
}

async function steeringTask(store) {
  const owner = await createOwner(store, "Subagent steering boundary");
  const harness = createSupervisorHarness(store, owner, {
    providerId: "subagent-steering",
    responses: [
      fauxAssistantMessage(
        fauxToolCall("list_files", { path: ".", depth: 0 }),
        {
          stopReason: "toolUse",
        },
      ),
      fauxAssistantMessage(outcome("Steering delivered at a safe boundary.")),
    ],
  });
  const handle = await harness.supervisor.start(request(owner, "Steering"));
  await harness.supervisor.send(handle, {
    text: "Focus on durable boundary evidence.",
  });
  const collected = await harness.supervisor.collect(handle);
  if (collected.status !== "completed")
    throw new Error("Steered Subagent did not complete");
  await store.finishRun(owner.run.id, "completed", { outcome: "completed" });
  return { owner, taskId: handle.taskId };
}

async function cancellationTask(store) {
  const owner = await createOwner(store, "Subagent cancellation boundary");
  const harness = createSupervisorHarness(store, owner, {
    providerId: "subagent-cancellation",
    responses: [fauxAssistantMessage(outcome("x".repeat(1_000)))],
    tokensPerSecond: 1,
  });
  const handle = await harness.supervisor.start(request(owner, "Cancellation"));
  await harness.supervisor.cancel(handle, "Acceptance probe cancellation.");
  const collected = await harness.supervisor.collect(handle);
  if (collected.status !== "cancelled")
    throw new Error("Subagent cancellation was not durable");
  await store.finishRun(owner.run.id, "completed", { outcome: "completed" });
  return { owner, taskId: handle.taskId };
}

function createSupervisorHarness(store, owner, options) {
  const faux = fauxProvider({
    provider: options.providerId,
    tokensPerSecond: options.tokensPerSecond ?? 1_000_000,
  });
  faux.setResponses(options.responses);
  const registry = new ModelRegistry();
  registry.registerProvider(faux.provider);
  const model = registry.resolve({
    provider: options.providerId,
    id: "faux-1",
  });
  if (!model) throw new Error("Subagent evidence model is unavailable");
  const provider = new InProcessSubagentProvider({
    store,
    models: registry.models,
    modelRouter: new ModelRouter(store, registry),
    defaultModel: model,
    run: owner.run,
    limits: {
      maxConcurrent: 2,
      maxTotal: options.maxTotal ?? 4,
      maxTurns: 4,
      timeoutMs: 5_000,
    },
    parentSignal: new AbortController().signal,
  });
  return { supervisor: new SubagentSupervisor(provider) };
}

async function createOwner(store, title) {
  const agent = store.listAgents()[0];
  const thread = await store.createThread({ title, agentId: agent.id });
  const run = await store.createRun({ threadId: thread.id, agentId: agent.id });
  return { thread, run };
}

function request(owner, label) {
  return {
    kind: "napier.subagent-request",
    schemaVersion: 1,
    threadId: owner.thread.id,
    runId: owner.run.id,
    role: "researcher",
    description: label,
    prompt: `Produce structured evidence for ${label}.`,
  };
}

function outcome(summary) {
  return JSON.stringify({ summary, items: [], unknowns: [] });
}

async function selectedEvents(store, owner) {
  return (await store.listEvents(owner.thread.id)).filter(
    (event) => event.runId === owner.run.id && SUBAGENT_EVENTS.has(event.type),
  );
}
