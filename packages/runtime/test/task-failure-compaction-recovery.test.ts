import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it } from "vitest";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { assertModelRequestEvidenceBindings } from "../src/model-prompt-evidence-bindings.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import {
  cleanupProgressFixtures,
  createFixture,
} from "./run-progress-vector-test-support.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

afterEach(cleanupProgressFixtures);

function workingState(context: Context) {
  const tail = JSON.parse(String(context.messages.at(-1)!.content));
  const source = tail.sources.find(
    (item: { sourceId: string }) =>
      item.sourceId === "workspace.task_working_state",
  );
  return JSON.parse(String(source.content).split("\n").at(-1)!);
}

it("retains distinct read failures through actual overflow compaction and store-reopened manual recovery", async () => {
  const f = await createFixture("failure-compaction-recovery");
  const workspaceRoot = f.store.workspaceRoot,
    dataRoot = f.store.dataRoot;
  await f.store.updateAgent(f.agentId, {
    enabledTools: ["read_file"],
    enabledSkills: [],
    enabledSubagents: [],
    runLimits: {
      maxTurns: 6,
      maxTotalTokens: 1_000_000,
      maxCostUsd: 100,
      timeoutMs: 60_000,
    },
  });
  for (const name of ["c", "d", "e"])
    await writeFile(
      path.join(workspaceRoot, `${name}.txt`),
      `${name}: ${"retained source material ".repeat(200)}`,
    );
  const provider = fauxProvider({
    provider: "failure-compaction-recovery",
    tokenSize: { min: 10_000, max: 10_000 },
    models: [
      {
        id: "bounded",
        contextWindow: 64_000,
        maxTokens: 1_024,
        reasoning: false,
      },
    ],
  });
  const seen: Context[] = [];
  let step = 0;
  let checkpointSummaries = 0;
  const respond: FauxResponseFactory = (context) => {
    if (!context.tools?.length) {
      const checkpoint = context.systemPrompt?.includes("checkpoint");
      if (checkpoint) checkpointSummaries++;
      return fauxAssistantMessage(
        checkpoint
          ? JSON.stringify({
              summary: "All earlier read failures are resolved.",
              decisions: [],
              openLoops: [],
              artifacts: [],
            })
          : '{"facts":[]}',
      );
    }
    seen.push({ ...context, messages: structuredClone(context.messages) });
    const current = step++;
    if (current === 4)
      return fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "context_length_exceeded",
      });
    return fauxAssistantMessage(
      fauxToolCall("read_file", {
        path: `${["a", "b", "c", "d", "e", "e"][current] ?? "e"}.txt`,
      }),
      { stopReason: "toolUse" },
    );
  };
  provider.setResponses(Array.from({ length: 20 }, () => respond));
  const models = new ModelRegistry();
  models.registerProvider(provider.provider);
  const profile = createModelHarnessExperimentProfile({
    id: "failure-compaction-recovery",
    maxActiveTools: 20,
    policies: createHarnessPolicyProfile({
      id: "failure-compaction-recovery",
      revision: 1,
      context: {
        prompt: "stable-v1",
        memory: "legacy",
        workingState: "evidence-v1",
        delivery: "tail-v1",
      },
      toolSurface: { editReferences: false },
      verification: "node-v1",
    }),
  });
  const parent = await processReadyAgentRuntime(f.store, models).runPrompt({
    threadId: f.threadId,
    text: "Inspect a.txt, b.txt, c.txt, d.txt and e.txt. Report missing inputs accurately; do not create them or repeat unrelated successful reads.",
    model: { provider: provider.provider.id, id: "bounded" },
    harnessExperimentProfile: profile,
  });
  expect(parent.status, parent.error).toBe("failed");
  expect(parent.outcome, parent.error).toBe("paused_budget");
  const parentEvents = await f.store.listRunEvents(parent.id);
  const failures = parentEvents.filter((event) => event.type === "tool.failed");
  expect(failures).toHaveLength(3);
  const missingInputs = failures.slice(0, 2);
  for (const event of missingInputs)
    expect(event.payload).toMatchObject({
      toolName: "read_file",
      toolFailure: { class: "not_found" },
    });
  // The sixth model turn emits a tool call, but the exhausted Run budget
  // rejects it before execution. Keep that separate failure visible too.
  const budgetFailure = failures[2]!;
  expect(budgetFailure.payload).toMatchObject({
    toolName: "read_file",
    outputTextBytes: 39,
    outputTextSha256: createHash("sha256")
      .update("Run budget exhausted: model turns 6 / 6")
      .digest("hex"),
  });
  const blocked = parentEvents.filter((event) => event.type === "tool.blocked");
  expect(blocked).toHaveLength(1);
  expect(blocked[0]!.payload).toMatchObject({
    callId: (budgetFailure.payload as { callId: string }).callId,
    policyReason: "Run budget exhausted: model turns 6 / 6",
    harnessInterventionReason: "budget_pause",
  });
  // One rejected budget invocation has both blocked and failed events.
  // The projection preserves both records; it does not imply two executions.
  const rejectedEvents = parentEvents.filter((event) =>
    ["tool.failed", "tool.blocked"].includes(event.type),
  );
  expect(
    parentEvents.filter(
      (event) => event.type === "context.run_compaction.completed",
    ),
  ).toHaveLength(1);
  expect(checkpointSummaries).toBe(1);
  expect(seen[5]!.messages.length).toBeLessThan(seen[4]!.messages.length);
  const compacted = workingState(seen[5]!);
  expect(
    compacted.rejectedAttempts.map((item: { eventId: string }) => item.eventId),
  ).toEqual(missingInputs.map((event) => event.id));
  expect(
    compacted.pendingActions.filter(
      (item: { action: string }) => item.action === "review_failure",
    ),
  ).toHaveLength(2);
  expect(() => assertModelRequestEvidenceBindings(parentEvents)).not.toThrow();
  const parentBytes = JSON.stringify(parentEvents);
  f.store.close();

  // Reopen durable storage and construct a fresh Runtime; this is not an OS crash test.
  const reopened = new LocalStore({ workspaceRoot, dataRoot });
  await reopened.initialize();
  try {
    await writeFile(
      path.join(workspaceRoot, "a.txt"),
      "The previously missing input is now available.\n",
    );
    const recoverySeen: Context[] = [];
    let recoveryStep = 0;
    const recover: FauxResponseFactory = (context) => {
      if (!context.tools?.length) return fauxAssistantMessage('{"facts":[]}');
      recoverySeen.push({
        ...context,
        messages: structuredClone(context.messages),
      });
      if (recoveryStep++ === 0)
        return fauxAssistantMessage(
          fauxToolCall("read_file", { path: "a.txt" }),
          { stopReason: "toolUse" },
        );
      return fauxAssistantMessage(
        "a.txt was read after becoming available; b.txt remains missing. The prior successful reads were retained.",
      );
    };
    provider.setResponses(Array.from({ length: 10 }, () => recover));
    const recovered = await processReadyAgentRuntime(
      reopened,
      models,
    ).resumeInterruptedRun({
      threadId: f.threadId,
      runId: parent.id,
      model: { provider: provider.provider.id, id: "bounded" },
    });
    expect(recovered.status, recovered.error).toBe("completed");
    expect(recovered.parentRunId).toBe(parent.id);
    expect(recoverySeen).toHaveLength(2);
    const initialRecovery = workingState(recoverySeen[0]!);
    expect(
      initialRecovery.pendingActions
        .filter((item: { action: string }) => item.action === "review_failure")
        .map((item: { eventId: string }) => item.eventId),
    ).toEqual(rejectedEvents.map((event) => event.id));
    const final = workingState(recoverySeen[1]!);
    expect(
      final.rejectedAttempts.map((item: { eventId: string }) => item.eventId),
    ).toEqual(rejectedEvents.map((event) => event.id));
    expect(final.rejectedAttempts[0].matchingCompletionObserved).toBe(true);
    expect(final.rejectedAttempts[1].matchingCompletionObserved).toBe(false);
    expect(final.rejectedAttempts[2].matchingCompletionObserved).toBe(false);
    expect(final.rejectedAttempts[3].matchingCompletionObserved).toBe(false);
    expect(
      final.pendingActions
        .filter((item: { action: string }) => item.action === "review_failure")
        .map((item: { eventId: string }) => item.eventId),
    ).toEqual([missingInputs[1]!.id, blocked[0]!.id, budgetFailure.id]);
    expect(final.completion).toBe("not_determined");
    const recoveryEvents = await reopened.listRunEvents(recovered.id);
    expect(
      recoveryEvents.filter((event) =>
        ["tool.failed", "tool.blocked"].includes(event.type),
      ),
    ).toHaveLength(0);
    expect(
      recoveryEvents.filter((event) => event.type === "tool.started"),
    ).toHaveLength(1);
    expect(() =>
      assertModelRequestEvidenceBindings(recoveryEvents),
    ).not.toThrow();
    expect(JSON.stringify(await reopened.listRunEvents(parent.id))).toBe(
      parentBytes,
    );
  } finally {
    reopened.close();
  }
});
