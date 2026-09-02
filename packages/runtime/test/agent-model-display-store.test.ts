import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import type {
  AssistantMessage,
  ToolResultMessage,
} from "@earendil-works/pi-ai";
import type { RunEvent } from "@napier/contracts";
import { afterEach, describe, expect, it } from "vitest";

import { AgentModelDisplayStore } from "../src/agent-model-display-store.js";
import { ConversationSurfaceCapsuleStore } from "../src/conversation-surface-capsule-store.js";

const temporaryRoots: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("AgentModelDisplayStore", () => {
  it("restores sanitized model text and thinking from private local files", async () => {
    const root = await temporaryRoot();
    const owner = {
      threadId: "thread_modeldisplay",
      runId: "run_model_display1",
      responseEventId: "event_modeldisplay",
      modelContextEnvelopeTurnIndex: 3,
    };
    await new AgentModelDisplayStore(root).recordResponse(owner, {
      text: "The verification passed.\nAuthorization: Bearer PRIVATE_TOKEN",
      thinking: "Inspecting the result. API_KEY=PRIVATE_KEY_VALUE",
    });

    // Re-open the store to model a server restart rather than reading an
    // in-memory object written by the same instance.
    const restarted = new AgentModelDisplayStore(root);
    const records = await restarted.listThread(owner.threadId);

    expect(records).toEqual([
      expect.objectContaining({
        sourceThreadId: owner.threadId,
        sourceRunId: owner.runId,
        responseEventId: owner.responseEventId,
        modelContextEnvelopeTurnIndex: owner.modelContextEnvelopeTurnIndex,
        text: "The verification passed.\nAuthorization: [redacted]",
        thinking: "Inspecting the result. API_KEY=[redacted]",
        origin: "captured_response",
      }),
    ]);
    expect(JSON.stringify(records)).not.toContain("PRIVATE_TOKEN");
    expect(JSON.stringify(records)).not.toContain("PRIVATE_KEY_VALUE");
    const [name] = await readdir(restarted.rootPath);
    expect((await stat(restarted.rootPath)).mode & 0o777).toBe(0o700);
    expect(
      (await stat(path.join(restarted.rootPath, name!))).mode & 0o777,
    ).toBe(0o600);
    expect(
      await readFile(path.join(restarted.rootPath, name!), "utf8"),
    ).not.toContain("PRIVATE_TOKEN");
  });

  it("reconstructs pre-upgrade model display from a bound conversation capsule", async () => {
    const root = await temporaryRoot();
    const threadId = "thread_legacydisplay";
    const runId = "run_legacy_display1";
    const envelopeSha256 = "a".repeat(64);
    const capsules = new ConversationSurfaceCapsuleStore(root);
    const receipt = await capsules.put({
      sourceThreadId: threadId,
      sourceRunId: runId,
      modelContextEnvelopeSha256: envelopeSha256,
      modelContextEnvelopeTurnIndex: 0,
      assistant: {
        role: "assistant",
        content: [
          { type: "thinking", thinking: "Recovered legacy reasoning." },
          { type: "text", text: "I will inspect the file." },
          {
            type: "toolCall",
            id: "call_legacy_display",
            name: "read_file",
            arguments: { path: "README.md" },
          },
        ],
      } as AssistantMessage,
      toolResults: [
        {
          role: "toolResult",
          toolCallId: "call_legacy_display",
          toolName: "read_file",
          content: [{ type: "text", text: "ok" }],
          details: {},
          isError: false,
        } as ToolResultMessage,
      ],
    });
    const events: RunEvent[] = [
      event(
        1,
        "event_responselegacy",
        "model.response",
        {
          modelContextEnvelopeSha256: envelopeSha256,
          modelContextEnvelopeTurnIndex: 0,
        },
        threadId,
        runId,
      ),
      event(
        2,
        "event_surfacelegacy",
        "context.conversation_surface",
        receipt,
        threadId,
        runId,
      ),
    ];
    const store = new AgentModelDisplayStore(root, {
      store: { listEvents: async () => events },
      capsules,
    });

    expect(await store.listThread(threadId)).toEqual([
      expect.objectContaining({
        responseEventId: "event_responselegacy",
        text: "I will inspect the file.",
        thinking: "Recovered legacy reasoning.",
        origin: "conversation_surface",
      }),
    ]);
  });
});

async function temporaryRoot(): Promise<string> {
  const root = await mkdtemp(path.join(tmpdir(), "napier-model-display-"));
  temporaryRoots.push(root);
  return root;
}

function event(
  seq: number,
  id: string,
  type: string,
  payload: RunEvent["payload"],
  threadId: string,
  runId: string,
): RunEvent {
  return {
    id,
    threadId,
    runId,
    seq,
    type,
    category: "model",
    visibility: "debug",
    createdAt: `2026-09-02T00:00:0${String(seq)}.000Z`,
    payload,
  };
}
