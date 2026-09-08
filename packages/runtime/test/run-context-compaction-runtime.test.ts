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

afterEach(cleanupProgressFixtures);

describe("AgentRuntime rolling context", () => {
  it("recovers a provider overflow inside a single user turn only after reducing the live execution chain", async () => {
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
    let step = 0;
    const respond: FauxResponseFactory = (context) => {
      if ((context.tools?.length ?? 0) === 0)
        return fauxAssistantMessage(
          context.systemPrompt?.includes("checkpoint")
            ? JSON.stringify(summary)
            : '{"facts":[]}',
        );
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
    const run = await processReadyAgentRuntime(f.store, models).runPrompt({
      threadId: f.threadId,
      text: request,
      model: { provider: "rolling-overflow-runtime", id: "bounded" },
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
    expect(
      seen[4]!.messages.some(
        (message) => message.role === "user" && message.content === request,
      ),
    ).toBe(true);
    expect(() => assertModelRequestEvidenceBindings(events)).not.toThrow();
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
    projection.payload = { ...content, status: "within_budget" };
    projection.payload = {
      ...projection.payload,
      contentSha256: sha256(canonicalJson(projection.payload)),
    };
    expect(() => assertModelRequestEvidenceBindings(unbound)).toThrow(
      "Run context projection source binding",
    );
    await f.store.close();
  });

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
