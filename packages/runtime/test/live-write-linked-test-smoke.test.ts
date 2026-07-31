import { createHash, randomBytes } from "node:crypto";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it } from "vitest";

import {
  AgentRuntime,
  createPlatformSandboxAdapter,
  LocalStore,
  ModelRegistry,
} from "../src/index.js";

const LIVE_ENABLED = process.env.NAPIER_LIVE_LINKED_TEST_SMOKE === "1";
const describeLive = LIVE_ENABLED ? describe : describe.skip;
const temporaryRoots: string[] = [];
const workspaceFixtures: string[] = [];

afterEach(async () => {
  await Promise.all([
    ...temporaryRoots
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
    ...workspaceFixtures
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  ]);
});

describeLive("live write-linked test smoke", () => {
  it("runs a selected real Vitest target through the Agent and OS Sandbox", async () => {
    const workspaceRoot = path.resolve(import.meta.dirname, "../../..");
    const suffix = randomBytes(8).toString("hex");
    const fixtureRoot = path.join(
      workspaceRoot,
      "examples",
      `.write-linked-live-${suffix}`,
    );
    workspaceFixtures.push(fixtureRoot);
    const sourcePath = path
      .relative(workspaceRoot, path.join(fixtureRoot, "value.ts"))
      .split(path.sep)
      .join("/");
    const testPath = path
      .relative(workspaceRoot, path.join(fixtureRoot, "value.test.ts"))
      .split(path.sep)
      .join("/");
    const source = "export const liveLinkedValue = 2 + 2;\n";
    await mkdir(fixtureRoot, { recursive: true });
    await Promise.all([
      writeFile(path.join(fixtureRoot, "value.ts"), source),
      writeFile(
        path.join(fixtureRoot, "value.test.ts"),
        [
          'import { expect, test } from "vitest";',
          'import { liveLinkedValue } from "./value.js";',
          'test("live linked value", () => expect(liveLinkedValue).toBe(4));',
          "",
        ].join("\n"),
      ),
    ]);
    const dataRoot = await mkdtemp(
      path.join(tmpdir(), "napier-live-linked-tests-"),
    );
    temporaryRoots.push(dataRoot);
    const store = new LocalStore({ workspaceRoot, dataRoot });
    await store.initialize();
    const agent = await store.updateAgent(store.listAgents()[0]!.id, {
      toolPolicy: "workspace",
      enabledTools: ["apply_patch", "verify_workspace"],
    });
    const thread = await store.createThread({
      title: "Live write-linked test smoke",
      agentId: agent.id,
    });
    const provider = fauxProvider({ provider: "live-write-linked-tests" });
    let toolMessages = "";
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("apply_patch", {
          operation: "replace",
          path: sourcePath,
          expectedSha256: sha256(source),
          edits: [{ oldText: "2 + 2", newText: "4" }],
        }),
        { stopReason: "toolUse" },
      ),
      (context) => {
        toolMessages = JSON.stringify(context.messages);
        return fauxAssistantMessage(
          "I inspected the write-linked test result returned by Napier.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    const models = new ModelRegistry();
    models.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      store,
      models,
      undefined,
      createPlatformSandboxAdapter(),
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Make the equivalent simplification and verify its relevant test.",
      model: { provider: "live-write-linked-tests", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(toolMessages).toContain(testPath);
    const events = await store.listEvents(thread.id);
    const patch = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "apply_patch",
    );
    expect(record(record(patch?.payload)?.["details"])?.["tests"]).toEqual(
      expect.objectContaining({
        status: "passed",
        selectedTestCount: 1,
        graphTruncated: false,
      }),
    );
    const durable = JSON.stringify(events);
    expect(durable).not.toContain(sourcePath);
    expect(durable).not.toContain(testPath);
    expect(durable).not.toContain("liveLinkedValue");
    store.close();
  }, 30_000);
});

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
