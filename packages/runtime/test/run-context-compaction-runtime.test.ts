import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Context,
  type FauxResponseFactory,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { assertModelRequestEvidenceBindings } from "../src/model-prompt-evidence-bindings.js";
import { createHarnessPolicyProfile } from "../src/harness-policy-profile.js";
import { createModelHarnessExperimentProfile } from "../src/model-harness-experiment-profile.js";
import { ModelRegistry } from "../src/models.js";
import { exportThreadReplayBundle } from "../src/replay.js";
import { verifyThreadReplayBundle } from "../src/thread-bundles.js";
import { completeContextUnits } from "../src/run-context-compaction-boundary.js";
import { rebindImportedRunContextCompaction } from "../src/run-context-compaction-import.js";
import {
  cleanupProgressFixtures,
  createFixture,
} from "./run-progress-vector-test-support.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";
import { summary } from "./run-context-compaction-test-support.js";
import {
  RUNTIME_CONTEXT_EVENT,
  assertRuntimeContextCapsule,
  validateRuntimeContextReceipt,
} from "../src/runtime-context-receipt.js";
import { ModelInvocationCapsuleStore } from "../src/model-invocation-capsule-store.js";

afterEach(cleanupProgressFixtures);

describe("AgentRuntime rolling context", () => {
  it.each([false, true, "tail-v1", "budget-tail-v2"])(
    "recovers provider overflow without replay, with stable working state=%s",
    async (usePolicy) => {
      const f = await createFixture("rolling-context-overflow");
      await f.store.updateAgent(f.agentId, {
        enabledTools: ["read_file"],
        enabledSkills: [],
        enabledSubagents: [],
      });
      for (let index = 0; index < 3; index++)
        await writeFile(
          path.join(f.store.workspaceRoot, `source-${index}.txt`),
          `Source ${index}: ${"verified information ".repeat(200)}`,
        );
      const provider = fauxProvider({
        provider: "rolling-overflow-runtime",
        tokenSize: { min: 10_000, max: 10_000 },
        models: [
          {
            id: "bounded",
            reasoning: false,
            contextWindow: 64_000,
            maxTokens: 1_024,
          },
        ],
      });
      const seen: Context[] = [];
      const auxiliary: Context[] = [];
      let step = 0;
      const respond: FauxResponseFactory = (context) => {
        if ((context.tools?.length ?? 0) === 0) {
          auxiliary.push(structuredClone(context));
          return fauxAssistantMessage(
            context.systemPrompt?.includes("checkpoint")
              ? JSON.stringify(summary)
              : '{"facts":[]}',
          );
        }
        seen.push({ ...context, messages: structuredClone(context.messages) });
        const current = step++;
        if (current < 3)
          return fauxAssistantMessage(
            fauxToolCall("read_file", { path: `source-${current}.txt` }),
            { stopReason: "toolUse" },
          );
        if (current === 3)
          return fauxAssistantMessage("", {
            stopReason: "error",
            errorMessage: "context_length_exceeded",
          });
        return fauxAssistantMessage("All three sources are inspected.");
      };
      provider.setResponses(Array.from({ length: 12 }, () => respond));
      const models = new ModelRegistry();
      models.registerProvider(provider.provider);
      const request = "Read all three sources. Do not change any files.";
      const amendment = "In the final response list the inspected filenames.";
      const memory =
        (usePolicy === "tail-v1" || usePolicy === "budget-tail-v2")
          ? await f.store.proposeMemory(
              {
                content: "Three sources use MEMORY_REVOKED_MARKER.",
                category: "context",
              },
              { type: "manual" },
            )
          : undefined;
      if (memory) await f.store.reviewMemory(memory.id, { action: "approve" });
      let steered = false;
      const run = await processReadyAgentRuntime(f.store, models).runPrompt({
        threadId: f.threadId,
        text: request,
        model: { provider: "rolling-overflow-runtime", id: "bounded" },
        onEvent: async (event) => {
          if (steered || event.type !== "tool.completed") return;
          steered = true;
          if (memory)
            await f.store.reviewMemory(memory.id, { action: "archive" });
          await f.store.queueRunControlMessage({
            threadId: f.threadId,
            runId: event.runId,
            mode: "steering",
            text: amendment,
          });
        },
        ...(usePolicy
          ? {
              harnessExperimentProfile: createModelHarnessExperimentProfile({
                id: "stable-compaction",
                maxActiveTools: 20,
                policies: createHarnessPolicyProfile({
                  id: "context-evidence",
                  revision: 1,
                  context: {
                    prompt: "stable-v1",
                    memory:
                      (usePolicy === "tail-v1" || usePolicy === "budget-tail-v2") ? "task-aware-v1" : "legacy",
                    workingState: "evidence-v1",
                    ...(usePolicy === "budget-tail-v2" ? { finalization: "request-aware-v2" as const } : {}),
                    ...((usePolicy === "tail-v1" || usePolicy === "budget-tail-v2")
                      ? { delivery: "tail-v1" as const }
                      : {}),
                  },
                  toolSurface: { editReferences: false },
                  verification: "node-v1",
                }),
              }),
            }
          : {}),
      });
      expect(run.status, run.error).toBe("completed");
      const events = await f.store.listRunEvents(run.id);
      expect(
        events.filter((event) => event.type === "model.context.overflow"),
      ).toHaveLength(1);
      expect(
        events.filter(
          (event) => event.type === "context.run_compaction.completed",
        ),
      ).toHaveLength(1);
      expect(
        events.filter((event) => event.type === "tool.completed"),
      ).toHaveLength(3);
      expect(seen[4]!.messages.length).toBeLessThan(seen[3]!.messages.length);
      if (usePolicy) {
        const projectedState =
          (usePolicy === "tail-v1" || usePolicy === "budget-tail-v2")
            ? String(
                JSON.parse(
                  String(seen[4]!.messages.at(-1)!.content),
                ).sources.find(
                  (source: { sourceId: string }) =>
                    source.sourceId === "workspace.task_working_state",
                ).content,
              )
            : seen[4]!.systemPrompt;
        expect(projectedState).toContain("napier.task-working-state");
        expect(projectedState).toContain(request);
        expect(projectedState).toContain(amendment);
        expect(projectedState).toContain('"instructionRevision":2');
        expect(projectedState).toContain('"controlMode":"steering"');
        expect(
          events.some(
            (event) =>
              event.type === "context.prompt_package" &&
              event.payload.assembly === "stable_prefix_layers_v1",
          ),
        ).toBe(true);
      }
      expect(
        seen[4]!.messages.some(
          (message) => message.role === "user" && message.content === request,
        ),
      ).toBe(true);
      expect(() => assertModelRequestEvidenceBindings(events)).not.toThrow();
      if ((usePolicy === "tail-v1" || usePolicy === "budget-tail-v2")) {
        const queries = events.filter(
          (event) =>
            event.type === "context.memory" &&
            event.payload.phase === "model_invocation",
        );
        const instructions = events.filter(
          (event) => event.type === "message.user",
        );
        expect(queries[0]!.payload.query).toMatchObject({
          sourceEventIds: [instructions[0]!.id],
        });
        expect(queries.at(-1)!.payload.query).toMatchObject({
          sourceEventIds: instructions.toReversed().map((event) => event.id),
          instructionRevision: 2,
        });
        expect(JSON.stringify(seen[0])).toContain("MEMORY_REVOKED_MARKER");
        expect(JSON.stringify(seen.slice(1))).not.toContain(
          "MEMORY_REVOKED_MARKER",
        );
        for (const context of seen) {
          expect(
            context.messages.filter(
              (message) =>
                typeof message.content === "string" &&
                message.content.includes('"kind":"napier.runtime-context"'),
            ),
          ).toHaveLength(1);
          expect(context.systemPrompt).not.toContain(
            "napier.task-working-state",
          );
        }
        expect(JSON.stringify(auxiliary)).not.toContain(
          "napier.runtime-context",
        );
        expect(
          JSON.stringify(
            events.filter(
              (event) =>
                event.type === "message.user" ||
                event.type === "context.run_compaction.completed",
            ),
          ),
        ).not.toContain("napier.runtime-context");
        const deliveries = events.filter(
          (event) => event.type === RUNTIME_CONTEXT_EVENT,
        );
        expect(deliveries).toHaveLength(seen.length);
        const capsules = new ModelInvocationCapsuleStore(f.store.dataRoot);
        for (const event of deliveries) {
          const capsuleEvent = events.find(
            (candidate) =>
              candidate.seq > event.seq &&
              candidate.type === "context.model_invocation" &&
              candidate.payload.purpose === "agent_turn",
          )!;
          const capsule = await capsules.read(
            String(capsuleEvent.payload.capsuleSha256),
          );
          assertRuntimeContextCapsule(
            validateRuntimeContextReceipt(event.payload),
            capsule.context,
          );
          if (usePolicy === "budget-tail-v2") {
            const packet = JSON.parse(String(capsule.context.messages.at(-1)!.content));
            const budgetSources = packet.sources.filter((source: { sourceId: string }) => source.sourceId === "workspace.run_budget");
            expect(budgetSources).toHaveLength(1);
            const snapshot = JSON.parse(budgetSources[0].content);
            const accounted = events.filter(entry => entry.seq < capsuleEvent.seq && ["model.response", "model.context.overflow", "model.thinking_loop.detected"].includes(entry.type)).reduce((total, entry) => {
              const accounting = entry.payload.usageAccounting;
              return total + (accounting && typeof accounting === "object" && !Array.isArray(accounting) ? Number(accounting.budgetTokens) : 0);
            }, 0);
            expect(snapshot.observed.accountedTokens).toBe(accounted);
          }
        }
        expect(() =>
          assertModelRequestEvidenceBindings(
            events.filter((event) => event.id !== deliveries[0]!.id),
          ),
        ).toThrow("Runtime context");
        const reordered = structuredClone(events);
        reordered.find((event) => event.id === deliveries[0]!.id)!.seq = 0;
        expect(() => assertModelRequestEvidenceBindings(reordered)).toThrow(
          "Runtime context",
        );
        const replay = await exportThreadReplayBundle(f.store, f.threadId);
        expect(() => verifyThreadReplayBundle(replay)).not.toThrow();
        const imported = await f.store.importThreadReplayBundle(replay);
        expect(() =>
          assertModelRequestEvidenceBindings(imported.events),
        ).not.toThrow();
      }
      const stage = events.find(
        (event) => event.type === "context.run_compaction.projected",
      )!;
      expect(() =>
        assertModelRequestEvidenceBindings(
          events.filter((event) => event.id !== stage.id),
        ),
      ).toThrow("Run context projection source binding");
      const unbound = structuredClone(events);
      const projection = unbound
        .filter((event) => event.type === "context.projected")
        .at(-1)!;
      const {
        runCompactionReceiptSha256: _binding,
        contentSha256: _hash,
        ...content
      } = projection.payload as Record<string, string>;
      projection.payload = {
        ...content,
        status: (usePolicy === "tail-v1" || usePolicy === "budget-tail-v2") ? "projected" : "within_budget",
      };
      projection.payload = {
        ...projection.payload,
        contentSha256: sha256(canonicalJson(projection.payload)),
      };
      expect(() => assertModelRequestEvidenceBindings(unbound)).toThrow(
        "Run context projection source binding",
      );
      await f.store.close();
    },
  );

  it("finishes a long tool chain in the same Run while retaining requirements and original tool evidence", async () => {
    const f = await createFixture("rolling-context-runtime");
    await f.store.updateAgent(f.agentId, {
      enabledTools: ["read_file", "apply_patch"],
      enabledSkills: [],
      enabledSubagents: [],
    });
    const output = `outputs/${f.threadId}/article.html`;
    await mkdir(path.join(f.store.workspaceRoot, path.dirname(output)), {
      recursive: true,
    });
    await writeFile(
      path.join(f.store.workspaceRoot, output),
      "<main>Draft</main>",
    );
    for (let index = 0; index < 10; index++)
      await writeFile(
        path.join(f.store.workspaceRoot, `section-${index}.txt`),
        `Source ${index}: ${"Detailed verified source material. ".repeat(300)}`,
      );
    const provider = fauxProvider({
      provider: "rolling-context-runtime",
      tokenSize: { min: 10_000, max: 10_000 },
      models: [
        {
          id: "bounded",
          reasoning: false,
          contextWindow: 24_000,
          maxTokens: 1_024,
        },
      ],
    });
    const seen: Context[] = [];
    let primary = 0;
    const request =
      "Read the ten source sections, update the article, and verify it. Keep the title unchanged. 不要发布网页。";
    const checkpointSummary = { ...summary, artifacts: [f.threadId] };
    const respond: FauxResponseFactory = (context) => {
      if ((context.tools?.length ?? 0) === 0)
        return fauxAssistantMessage(
          context.systemPrompt?.includes("checkpoint")
            ? JSON.stringify(checkpointSummary)
            : '{"facts":[]}',
        );
      seen.push({ ...context, messages: structuredClone(context.messages) });
      const step = primary++;
      if (step < 10)
        return fauxAssistantMessage(
          fauxToolCall("read_file", { path: `section-${step}.txt` }),
          { stopReason: "toolUse" },
        );
      if (step === 10)
        return fauxAssistantMessage(
          fauxToolCall("apply_patch", {
            operation: "replace",
            path: output,
            expectedSha256: sha256("<main>Draft</main>"),
            edits: [{ oldText: "Draft", newText: "Verified article" }],
          }),
          { stopReason: "toolUse" },
        );
      if (step === 11)
        return fauxAssistantMessage(
          fauxToolCall("read_file", { path: output }),
          { stopReason: "toolUse" },
        );
      return fauxAssistantMessage(
        "The article is updated and checked; it has not been published.",
      );
    };
    provider.setResponses(Array.from({ length: 35 }, () => respond));
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const run = await processReadyAgentRuntime(f.store, models).runPrompt({
      threadId: f.threadId,
      text: request,
      model: { provider: "rolling-context-runtime", id: "bounded" },
    });
    expect(
      run.status,
      JSON.stringify({
        error: run.error,
        diagnostics: (await f.store.listRunEvents(run.id))
          .filter(
            (event) =>
              event.type === "run.failed" ||
              event.type === "model.response" ||
              event.type === "context.run_compaction.failed",
          )
          .map((event) => event.payload),
        primary,
      }),
    ).toBe("completed");
    expect(
      await readFile(path.join(f.store.workspaceRoot, output), "utf8"),
    ).toBe("<main>Verified article</main>");
    const events = await f.store.listRunEvents(run.id);
    const checkpoints = events.filter(
      (event) => event.type === "context.run_compaction.completed",
    );
    expect(checkpoints.length).toBeGreaterThan(0);
    expect(
      events.filter((event) => event.type === "tool.completed"),
    ).toHaveLength(12);
    expect(events.filter((event) => event.type === "run.started")).toHaveLength(
      1,
    );
    expect(events.some((event) => event.type === "run.no_progress")).toBe(
      false,
    );
    expect(
      seen.some((context) =>
        JSON.stringify(context.messages).includes("<run_context_checkpoint>"),
      ),
    ).toBe(true);
    for (const context of seen) {
      expect(
        context.messages.some(
          (message) => message.role === "user" && message.content === request,
        ),
      ).toBe(true);
      expect(() => completeContextUnits(context.messages)).not.toThrow();
    }
    expect(() => assertModelRequestEvidenceBindings(events)).not.toThrow();
    const brokenChain = structuredClone(events);
    const firstCheckpoint = brokenChain.find(
      (event) => event.type === "context.run_compaction.completed",
    )!;
    firstCheckpoint.payload = {
      ...(firstCheckpoint.payload as Record<string, string>),
      parentCheckpointSha256: sha256("missing parent"),
    };
    rebindImportedRunContextCompaction(brokenChain);
    expect(() => assertModelRequestEvidenceBindings(brokenChain)).toThrow(
      "Run context projection source binding",
    );
    const substituted = structuredClone(events);
    const substitutedCheckpoint = substituted.find(
      (event) => event.type === "context.run_compaction.completed",
    )!;
    substitutedCheckpoint.payload = {
      ...(substitutedCheckpoint.payload as Record<string, string>),
      summary: {
        ...checkpointSummary,
        summary: "Invented successful completion.",
      },
    };
    rebindImportedRunContextCompaction(substituted);
    expect(() => assertModelRequestEvidenceBindings(substituted)).toThrow(
      "Run context projection source binding",
    );
    const bundle = await exportThreadReplayBundle(f.store, f.threadId);
    const imported = await f.store.importThreadReplayBundle(bundle);
    expect(imported.thread.id).not.toBe(f.threadId);
    expect(() =>
      assertModelRequestEvidenceBindings(imported.events),
    ).not.toThrow();
    expect(
      imported.events.find(
        (event) => event.type === "context.run_compaction.completed",
      )?.payload,
    ).toMatchObject({ summary: checkpointSummary });
    const reexported = await exportThreadReplayBundle(
      f.store,
      imported.thread.id,
    );
    expect(() => verifyThreadReplayBundle(reexported)).not.toThrow();
    await f.store.close();
  });
});
