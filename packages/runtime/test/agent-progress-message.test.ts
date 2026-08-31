import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import { ModelRegistry } from "../src/models.js";
import { LocalStore } from "../src/store.js";
import { processReadyAgentRuntime } from "./process-run-readiness-test-fixture.js";

const roots: string[] = [];
const stores: LocalStore[] = [];

afterEach(async () => {
  for (const store of stores.splice(0)) store.close();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("AgentRuntime progress messages", () => {
  it("preserves prompt images in the live agent loop", async () => {
    const fixture = await createFixture("faux-prompt-image", false, true);
    fixture.provider.setResponses([
      (context) => {
        expect(context.messages.at(-1)).toEqual(
          expect.objectContaining({
            role: "user",
            content: [
              { type: "text", text: "Inspect the attached image." },
              {
                type: "image",
                mimeType: "image/png",
                data: "iVBORw==",
              },
            ],
          }),
        );
        return fauxAssistantMessage("The image is available to the model.");
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);

    const run = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Inspect the attached image.",
      images: [{ mimeType: "image/png", data: "iVBORw==" }],
      model: { provider: "faux-prompt-image", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
  });

  it("publishes explicit intermediate text with a source receipt", async () => {
    const fixture = await createFixture("faux-progress-public");
    fixture.provider.setResponses([
      (context) => {
        expect(context.systemPrompt).toContain("<operator_progress_protocol>");
        expect(context.systemPrompt).toContain(
          "same assistant response as the tool call",
        );
        return fauxAssistantMessage(
          [
            fauxText("I have mapped the entry point; next I will inspect it."),
            fauxToolCall("read_file", { path: "entry.txt" }),
          ],
          { stopReason: "toolUse" },
        );
      },
      fauxAssistantMessage("The entry point is verified."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);

    const run = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Inspect the entry point.",
      model: { provider: "faux-progress-public", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const events = await fixture.store.listEvents(fixture.threadId);
    const response = events.find(
      (event) =>
        event.type === "model.response" &&
        Array.isArray(record(event.payload)?.["toolCalls"]),
    );
    const progress = events.find(
      (event) => event.type === "run.progress.message",
    );
    expect(progress).toEqual(
      expect.objectContaining({
        category: "message",
        visibility: "user",
        payload: expect.objectContaining({
          sourceEventId: response?.id,
          model: "faux-progress-public/faux-1",
          toolNames: ["read_file"],
          text: "I have mapped the entry point; next I will inspect it.",
        }),
      }),
    );
  });

  it("publishes a safe fallback receipt when a provider omits narration", async () => {
    const fixture = await createFixture("faux-progress-fallback");
    fixture.provider.setResponses([
      fauxAssistantMessage(fauxToolCall("read_file", { path: "entry.txt" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("The entry point is verified."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);

    const run = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Inspect the entry point.",
      model: { provider: "faux-progress-fallback", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const progress = (await fixture.store.listEvents(fixture.threadId)).find(
      (event) => event.type === "run.progress.message",
    );
    expect(progress?.payload).toEqual(
      expect.objectContaining({
        model: "faux-progress-fallback/faux-1",
        toolNames: ["read_file"],
      }),
    );
    expect(record(progress?.payload)?.["text"]).toBeUndefined();
  });

  it("fails closed for tool narration under an enforced advisor", async () => {
    const fixture = await createFixture("faux-progress-advisor", true);
    fixture.provider.setResponses([
      fauxAssistantMessage(
        [
          fauxText("PRIVATE_DANGEROUS_TEXT git reset --hard"),
          fauxToolCall("read_file", { path: "entry.txt" }),
        ],
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The entry point was inspected safely."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);

    const run = await fixture.runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Inspect the entry point safely.",
      model: { provider: "faux-progress-advisor", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    const events = await fixture.store.listEvents(fixture.threadId);
    const progress = events.find(
      (event) => event.type === "run.progress.message",
    );
    expect(progress?.payload).toEqual(
      expect.objectContaining({
        toolNames: ["read_file"],
        contentRedacted: true,
      }),
    );
    expect(record(progress?.payload)?.["text"]).toBeUndefined();
    expect(
      JSON.stringify(events.filter((event) => event.visibility === "user")),
    ).not.toContain("PRIVATE_DANGEROUS_TEXT");
  });
});

async function createFixture(
  providerName: string,
  enforceAdvisor = false,
  vision = false,
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-progress-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await writeFile(path.join(workspaceRoot, "entry.txt"), "entry\n", "utf8");
  const store = new LocalStore({
    dataRoot: path.join(root, "state"),
    workspaceRoot,
  });
  await store.initialize();
  stores.push(store);
  let agent = store.listAgents()[0]!;
  if (enforceAdvisor) {
    agent = await store.updateAgent(agent.id, {
      modelAdvisor: {
        mode: "enforce",
        enabledRules: ["destructive_command_reference"],
      },
    });
  }
  const thread = await store.createThread({
    title: "Progress fixture",
    agentId: agent.id,
  });
  const provider = fauxProvider({ provider: providerName });
  const models = new ModelRegistry();
  models.registerProvider(
    vision
      ? {
          ...provider.provider,
          getModels: () =>
            provider.provider
              .getModels()
              .map((model) => ({ ...model, input: ["text", "image"] })),
        }
      : provider.provider,
  );
  return {
    store,
    threadId: thread.id,
    provider,
    runtime: processReadyAgentRuntime(store, models),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
