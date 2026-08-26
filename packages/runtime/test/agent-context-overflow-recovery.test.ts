import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { fauxAssistantMessage, fauxProvider } from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { canonicalJson, sha256 } from "../src/ed25519.js";
import { assertModelRequestEvidenceBindings } from "../src/model-prompt-evidence-bindings.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent context overflow recovery", () => {
  it("records the failed envelope and retries once with a shorter complete suffix", async () => {
    const fixture = await createFixture();
    const seenMessageCounts: number[] = [];
    const seenContexts: string[] = [];
    const provider = fauxProvider({
      provider: "overflow-recovery",
      models: [
        {
          id: "bounded",
          reasoning: false,
          contextWindow: 32_000,
          maxTokens: 1_024,
        },
      ],
    });
    provider.setResponses([
      fauxAssistantMessage("Seeded historical response."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.models.registerProvider(provider.provider);
    const runtime = processReadyAgentRuntime(fixture.store, fixture.models);
    const seeded = "Historical context " + "x".repeat(2_000);

    await runtime.runPrompt({
      threadId: fixture.threadId,
      text: seeded,
      model: { provider: "overflow-recovery", id: "bounded" },
    });
    provider.setResponses([
      (context) => {
        seenMessageCounts.push(context.messages.length);
        seenContexts.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("", {
          stopReason: "error",
          errorMessage: "context_length_exceeded",
        });
      },
      (context) => {
        seenMessageCounts.push(context.messages.length);
        seenContexts.push(JSON.stringify(context.messages));
        return fauxAssistantMessage("Recovered with a shorter suffix.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Latest protected request",
      model: { provider: "overflow-recovery", id: "bounded" },
    });

    const events = await fixture.store.listEvents(fixture.threadId);
    const runEvents = events.filter((event) => event.runId === run.id);
    expect(
      run.status,
      JSON.stringify({
        error: run.error,
        types: runEvents.map((event) => event.type),
        seenContexts,
      }),
    ).toBe("completed");
    expect(
      seenMessageCounts[0],
      JSON.stringify({ seenMessageCounts, seenContexts }),
    ).toBeGreaterThan(seenMessageCounts[1]!);
    expect(seenContexts.at(-1)).toContain("Latest protected request");
    expect(seenContexts.at(-1)).not.toContain("Historical context");
    const agentInvocations = runEvents.filter(
      (event) =>
        event.type === "context.model_invocation" &&
        typeof event.payload === "object" &&
        !Array.isArray(event.payload) &&
        event.payload?.["purpose"] === "agent_turn",
    );
    const overflow = runEvents.filter(
      (event) => event.type === "model.context.overflow",
    );
    const pressures = runEvents.filter(
      (event) => event.type === "model.context.token_pressure",
    );
    const projections = runEvents.filter(
      (event) => event.type === "context.projected",
    );
    expect(agentInvocations).toHaveLength(2);
    expect(overflow).toHaveLength(1);
    expect(overflow[0]!.payload).toEqual(
      expect.objectContaining({
        action: "retry",
        diagnosticSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
        modelContextEnvelopeTurnIndex: 0,
      }),
    );
    expect(pressures.map((event) => event.payload)).toEqual([
      expect.objectContaining({ recoveryAttempt: 0, status: "within_budget" }),
      expect.objectContaining({
        recoveryAttempt: 1,
        status: "projected",
        removedUnitCount: 1,
      }),
    ]);
    expect(projections.map((event) => event.payload)).toEqual([
      expect.objectContaining({
        recoveryAttempt: 0,
        status: "within_budget",
      }),
      expect.objectContaining({
        recoveryAttempt: 1,
        status: "projected",
        removedUnitCount: 1,
      }),
    ]);
    expect(() =>
      assertModelRequestEvidenceBindings(runEvents, {
        knownRunIds: new Set([run.id]),
      }),
    ).not.toThrow();
    const tamperedPressure = rehash({
      ...(pressures[1]!.payload as Record<string, unknown>),
      activeMessageSetSha256: "0".repeat(64),
    });
    const tampered = runEvents.map((event) => {
      if (event.id === pressures[1]!.id) {
        return { ...event, payload: tamperedPressure };
      }
      if (event.id === projections[1]!.id) {
        return {
          ...event,
          payload: rehash({
            ...(event.payload as Record<string, unknown>),
            activeMessageSetSha256: "0".repeat(64),
            tokenPressureReceiptSha256: tamperedPressure["contentSha256"],
          }),
        };
      }
      return event;
    });
    expect(() => assertModelRequestEvidenceBindings(tampered)).toThrow(
      "envelope binding is invalid",
    );
    expect(JSON.stringify(overflow)).not.toContain("Maximum context");
    fixture.store.close();
  });

  it("does not retry when no older complete unit can be removed", async () => {
    const fixture = await createFixture();
    const provider = fauxProvider({
      provider: "overflow-no-history",
      models: [
        {
          id: "bounded",
          reasoning: false,
          contextWindow: 32_000,
          maxTokens: 1_024,
        },
      ],
    });
    provider.setResponses([
      fauxAssistantMessage("", {
        stopReason: "error",
        errorMessage: "Maximum context length exceeded",
      }),
    ]);
    fixture.models.registerProvider(provider.provider);
    const runtime = processReadyAgentRuntime(fixture.store, fixture.models);

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Only protected request",
      model: { provider: "overflow-no-history", id: "bounded" },
    });

    expect(run.status).toBe("failed");
    const events = (await fixture.store.listEvents(fixture.threadId)).filter(
      (event) => event.runId === run.id,
    );
    expect(
      events.filter(
        (event) =>
          event.type === "context.model_invocation" &&
          typeof event.payload === "object" &&
          !Array.isArray(event.payload) &&
          event.payload?.["purpose"] === "agent_turn",
      ),
    ).toHaveLength(1);
    expect(
      events.filter((event) => event.type === "model.context.overflow"),
    ).toHaveLength(1);
    expect(
      events
        .filter((event) => event.type === "model.context.token_pressure")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ recoveryAttempt: 0, status: "within_budget" }),
      expect.objectContaining({
        recoveryAttempt: 1,
        status: "unavailable",
        failureReason: "provider_overflow_without_removable_history",
      }),
    ]);
    expect(
      events
        .filter((event) => event.type === "context.projected")
        .map((event) => event.payload),
    ).toEqual([
      expect.objectContaining({ recoveryAttempt: 0, status: "within_budget" }),
      expect.objectContaining({ recoveryAttempt: 1, status: "unavailable" }),
    ]);
    expect(() => assertModelRequestEvidenceBindings(events)).not.toThrow();
    fixture.store.close();
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-context-overflow-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const thread = await store.createThread({
    title: "Context overflow recovery",
    agentId: store.listAgents()[0]!.id,
  });
  return { store, models: new ModelRegistry(), threadId: thread.id };
}

function rehash(payload: Record<string, unknown>): Record<string, unknown> {
  const { contentSha256: _contentSha256, ...content } = payload;
  return { ...content, contentSha256: sha256(canonicalJson(content)) };
}
