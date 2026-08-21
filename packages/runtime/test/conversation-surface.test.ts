import { mkdtemp, mkdir, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  type Message,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { AgentRuntime } from "../src/agent-runtime.js";
import { contextMessageEvents } from "../src/compaction.js";
import { projectConversationSurface } from "../src/conversation-surface.js";
import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Conversation Surface", () => {
  it("restores a complete tool exchange into the next Run", async () => {
    const fixture = await createFixture("complete");
    const first = fauxProvider({ provider: "faux-surface-first" });
    first.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The evidence file was read successfully."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(first.provider);

    const firstRun = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read the evidence file.",
      model: { provider: "faux-surface-first", id: "faux-1" },
    });
    expect(firstRun.status).toBe("completed");

    let observed: Message[] = [];
    const second = fauxProvider({ provider: "faux-surface-second" });
    second.setResponses([
      (context) => {
        observed = context.messages;
        return fauxAssistantMessage(
          "The prior tool result remains available in this Run.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(second.provider);

    const secondRun = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Use the result from the previous Run.",
      model: { provider: "faux-surface-second", id: "faux-1" },
    });

    expect(secondRun.status).toBe("completed");
    const assistantIndex = observed.findIndex(
      (message) =>
        message.role === "assistant" &&
        message.content.some(
          (item) =>
            item.type === "toolCall" &&
            item.name === "read_file" &&
            item.arguments["path"] === "evidence.txt",
        ),
    );
    expect(assistantIndex).toBeGreaterThanOrEqual(0);
    expect(observed[assistantIndex + 1]).toEqual(
      expect.objectContaining({
        role: "toolResult",
        toolName: "read_file",
        isError: false,
      }),
    );
    expect(JSON.stringify(observed[assistantIndex + 1])).toContain(
      "canonical cross-run evidence",
    );
    expect(
      (await fixture.store.listEvents(fixture.threadId)).find(
        (event) =>
          event.runId === secondRun.id && event.type === "context.prepared",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        toolExchangeCount: 1,
        omittedToolExchangeCount: 0,
      }),
    );
  });

  it("keeps text but isolates parent tool exchanges from a recovery Run", async () => {
    const fixture = await createFixture("recovery-boundary");
    const provider = fauxProvider({ provider: "faux-surface-recovery" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The parent text remains recovery context."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const parent = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read the private parent artifact.",
      model: { provider: "faux-surface-recovery", id: "faux-1" },
    });
    const recovery = await fixture.store.createRun({
      threadId: fixture.threadId,
      agentId: parent.agentId,
      model: { provider: "faux-surface-recovery", id: "faux-1" },
      source: "recovery",
      parentRunId: parent.id,
    });
    await fixture.store.appendEvent({
      threadId: fixture.threadId,
      runId: recovery.id,
      type: "run.recovery.started",
      category: "lifecycle",
      visibility: "user",
      payload: { parentRunId: parent.id, status: "running", mode: "manual" },
    });
    const events = await fixture.store.listEvents(fixture.threadId);
    const projection = await projectConversationSurface({
      events,
      textEvents: contextMessageEvents(events),
      model: provider.getModel(),
      importedEventCount: 0,
      minimumEventSeq: 1,
      projectionRun: recovery,
      capsules: fixture.runtime.conversationSurfaceCapsules,
      resultCapsules: fixture.runtime.toolInvocationResultCapsules,
      modelInvocationCapsules: fixture.runtime.modelInvocationCapsules,
    });

    expect(JSON.stringify(projection.messages)).toContain(
      "The parent text remains recovery context.",
    );
    expect(JSON.stringify(projection.messages)).not.toContain("evidence.txt");
    expect(projection.toolExchangeCount).toBe(0);
  });

  it("fails closed when the private Surface capsule is unavailable", async () => {
    const fixture = await createFixture("missing");
    const first = fauxProvider({ provider: "faux-surface-missing-first" });
    first.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The first Run completed after reading the file."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(first.provider);
    await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read the evidence file.",
      model: { provider: "faux-surface-missing-first", id: "faux-1" },
    });

    const surfaceEvent = (
      await fixture.store.listEvents(fixture.threadId)
    ).find((event) => event.type === "context.conversation_surface");
    const capsuleSha256 = record(surfaceEvent?.payload)?.["capsuleSha256"];
    expect(typeof capsuleSha256).toBe("string");
    await unlink(
      path.join(
        fixture.runtime.conversationSurfaceCapsules.rootPath,
        `${String(capsuleSha256)}.json`,
      ),
    );

    let observed: Message[] = [];
    const second = fauxProvider({ provider: "faux-surface-missing-second" });
    second.setResponses([
      (context) => {
        observed = context.messages;
        return fauxAssistantMessage("The textual history remains usable.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(second.provider);
    const secondRun = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Continue safely.",
      model: { provider: "faux-surface-missing-second", id: "faux-1" },
    });

    expect(secondRun.status).toBe("completed");
    expect(JSON.stringify(observed)).toContain(
      "The first Run completed after reading the file.",
    );
    expect(
      observed.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some((item) => item.type === "toolCall"),
      ),
    ).toBe(false);
    expect(observed.some((message) => message.role === "toolResult")).toBe(
      false,
    );
    expect(
      (await fixture.store.listEvents(fixture.threadId)).find(
        (event) =>
          event.runId === secondRun.id && event.type === "context.prepared",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        toolExchangeCount: 0,
        omittedToolExchangeCount: 1,
      }),
    );
  });

  it("recovers pre-upgrade exchanges from the next bound model invocation", async () => {
    const fixture = await createFixture("legacy");
    const first = fauxProvider({ provider: "faux-surface-legacy" });
    first.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The legacy-compatible Run completed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(first.provider);
    await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read the legacy evidence.",
      model: { provider: "faux-surface-legacy", id: "faux-1" },
    });

    const events = (await fixture.store.listEvents(fixture.threadId)).filter(
      (event) =>
        event.type !== "context.conversation_surface" &&
        event.type !== "context.conversation_surface_unavailable",
    );
    const projection = await projectConversationSurface({
      events,
      textEvents: contextMessageEvents(events),
      model: first.getModel(),
      importedEventCount: 0,
      minimumEventSeq: 1,
      capsules: fixture.runtime.conversationSurfaceCapsules,
      resultCapsules: fixture.runtime.toolInvocationResultCapsules,
      modelInvocationCapsules: fixture.runtime.modelInvocationCapsules,
    });

    expect(projection.toolExchangeCount).toBe(1);
    expect(projection.omittedToolExchangeCount).toBe(0);
    const toolCallIndex = projection.messages.findIndex(
      (message) =>
        message.role === "assistant" &&
        message.content.some((item) => item.type === "toolCall"),
    );
    expect(projection.messages[toolCallIndex + 1]).toEqual(
      expect.objectContaining({ role: "toolResult", toolName: "read_file" }),
    );
    expect(JSON.stringify(projection.messages[toolCallIndex + 1])).toContain(
      "canonical cross-run evidence",
    );
  });

  it("omits a whole multi-tool exchange when one result binding is lost", async () => {
    const fixture = await createFixture("multi-missing");
    const first = fauxProvider({ provider: "faux-surface-multi-first" });
    first.setResponses([
      fauxAssistantMessage(
        [
          fauxToolCall(
            "read_file",
            { path: "evidence.txt" },
            { id: "call_evidence" },
          ),
          fauxToolCall(
            "read_file",
            { path: "second.txt" },
            { id: "call_second" },
          ),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Both files were read."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(first.provider);
    await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read both files.",
      model: { provider: "faux-surface-multi-first", id: "faux-1" },
    });

    const resultReceipts = (await fixture.store.listEvents(fixture.threadId))
      .filter((event) => event.type === "context.tool_result")
      .map((event) => record(event.payload)?.["capsuleSha256"])
      .filter((value): value is string => typeof value === "string");
    expect(resultReceipts).toHaveLength(2);
    await unlink(
      path.join(
        fixture.runtime.toolInvocationResultCapsules.rootPath,
        `${resultReceipts[0]}.json`,
      ),
    );

    let observed: Message[] = [];
    const second = fauxProvider({ provider: "faux-surface-multi-second" });
    second.setResponses([
      (context) => {
        observed = context.messages;
        return fauxAssistantMessage("The incomplete exchange was omitted.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(second.provider);
    const secondRun = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Continue without partial tool history.",
      model: { provider: "faux-surface-multi-second", id: "faux-1" },
    });

    expect(
      observed.some(
        (message) =>
          message.role === "assistant" &&
          message.content.some((item) => item.type === "toolCall"),
      ),
    ).toBe(false);
    expect(observed.some((message) => message.role === "toolResult")).toBe(
      false,
    );
    expect(
      (await fixture.store.listEvents(fixture.threadId)).find(
        (event) =>
          event.runId === secondRun.id && event.type === "context.prepared",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        toolExchangeCount: 0,
        omittedToolExchangeCount: 1,
      }),
    );
  });

  it("fails closed when a result receipt is absent from the Ledger", async () => {
    const fixture = await createFixture("missing-receipt");
    const provider = fauxProvider({ provider: "faux-surface-missing-receipt" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The receipt-bound Run completed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read evidence with a result receipt.",
      model: { provider: "faux-surface-missing-receipt", id: "faux-1" },
    });

    const events = (await fixture.store.listEvents(fixture.threadId)).filter(
      (event) => event.type !== "context.tool_result",
    );
    const projection = await projectConversationSurface({
      events,
      textEvents: contextMessageEvents(events),
      model: provider.getModel(),
      importedEventCount: 0,
      minimumEventSeq: 1,
      capsules: fixture.runtime.conversationSurfaceCapsules,
      resultCapsules: fixture.runtime.toolInvocationResultCapsules,
      modelInvocationCapsules: fixture.runtime.modelInvocationCapsules,
    });

    expect(projection.toolExchangeCount).toBe(0);
    expect(projection.omittedToolExchangeCount).toBe(1);
    expect(hasToolMessages(projection.messages)).toBe(false);
  });

  it("omits an exchange when the retained boundary splits its events", async () => {
    const fixture = await createFixture("retained-boundary");
    const provider = fauxProvider({ provider: "faux-surface-boundary" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("read_file", { path: "evidence.txt" }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The boundary Run completed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Read evidence before the retained boundary.",
      model: { provider: "faux-surface-boundary", id: "faux-1" },
    });

    const events = await fixture.store.listEvents(fixture.threadId);
    const response = events.find(
      (event) =>
        event.type === "model.response" &&
        Array.isArray(record(event.payload)?.["toolCalls"]),
    );
    expect(response).toBeDefined();
    const minimumEventSeq = response!.seq + 1;
    const projection = await projectConversationSurface({
      events,
      textEvents: contextMessageEvents(events).filter(
        (event) => event.seq >= minimumEventSeq,
      ),
      model: provider.getModel(),
      importedEventCount: 0,
      minimumEventSeq,
      capsules: fixture.runtime.conversationSurfaceCapsules,
      resultCapsules: fixture.runtime.toolInvocationResultCapsules,
      modelInvocationCapsules: fixture.runtime.modelInvocationCapsules,
    });

    expect(projection.toolExchangeCount).toBe(0);
    expect(projection.omittedToolExchangeCount).toBe(1);
    expect(hasToolMessages(projection.messages)).toBe(false);
  });
});

async function createFixture(label: string) {
  const root = await mkdtemp(
    path.join(tmpdir(), `napier-conversation-surface-${label}-`),
  );
  temporaryRoots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot, { recursive: true });
  await writeFile(
    path.join(workspaceRoot, "evidence.txt"),
    "canonical cross-run evidence\n",
    "utf8",
  );
  await writeFile(
    path.join(workspaceRoot, "second.txt"),
    "second cross-run result\n",
    "utf8",
  );
  const store = new LocalStore({
    dataRoot: path.join(root, "data"),
    workspaceRoot,
  });
  await store.initialize();
  const agent = store.listAgents()[0]!;
  const thread = await store.createThread({
    title: `Conversation Surface ${label}`,
    agentId: agent.id,
  });
  const registry = new ModelRegistry();
  const runtime = processReadyAgentRuntime(store, registry) as AgentRuntime;
  return { store, registry, runtime, threadId: thread.id };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

function hasToolMessages(messages: Message[]): boolean {
  return messages.some(
    (message) =>
      message.role === "toolResult" ||
      (message.role === "assistant" &&
        message.content.some((item) => item.type === "toolCall")),
  );
}
