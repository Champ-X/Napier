import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import { AgentRuntime, LocalStore, ModelRegistry } from "../src/index.js";
import { BrowserInteractionConfirmationManager } from "../src/browser-interaction-confirmations.js";
import {
  cleanupBrowserSessionHarnesses,
  createBrowserSessionHarness,
} from "./browser-session-harness.js";

const roots: string[] = [];

afterEach(async () => {
  await cleanupBrowserSessionHarnesses();
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Browser confirmation freshness", () => {
  it("blocks a stale target and admits only a fresh confirmation retry", async () => {
    const fixture = await createFixture();
    const harness = await createBrowserSessionHarness();
    const provider = fauxProvider({ provider: "faux-browser-stale-target" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "start",
          url: "https://example.com/",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "click",
          target: { ref: "e3" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("browser", { action: "snapshot" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "click",
          target: { ref: "e3" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Fresh target retry completed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const confirmations = new BrowserInteractionConfirmationManager(
      fixture.store,
      { available: true, timeoutMs: 5_000 },
    );
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
      undefined,
      undefined,
      undefined,
      undefined,
      harness.manager,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      confirmations,
    );
    const running = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Click only the exact confirmed Browser target.",
      model: { provider: "faux-browser-stale-target", id: "faux-1" },
    });
    const first = await pendingConfirmation(fixture, confirmations);
    harness.pages[0]!.ariaSnapshotText =
      '- button "Changed semantic target" [ref=e3]';
    await approve(fixture, confirmations, first);
    await vi.waitFor(() => {
      expect(harness.pages[0]?.clicked).toEqual([]);
      expect(
        harness.manager.hasActiveSession({
          threadId: fixture.threadId,
          runId: fixture.store.listRuns(fixture.threadId)[0]!.id,
        }),
      ).toBe(true);
    });
    const second = await pendingConfirmation(fixture, confirmations);
    expect(second.id).not.toBe(first.id);
    expect(second.preview.pageStateSha256).not.toBe(
      first.preview.pageStateSha256,
    );
    await approve(fixture, confirmations, second);

    const run = await running;

    expect(run.status, run.error).toBe("completed");
    expect(harness.pages[0]?.clicked).toEqual(["aria-ref=e3"]);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events
        .filter((event) =>
          event.type.startsWith("browser.interaction_confirmation."),
        )
        .map((event) => event.type),
    ).toEqual([
      "browser.interaction_confirmation.pending",
      "browser.interaction_confirmation.approved",
      "browser.interaction_confirmation.pending",
      "browser.interaction_confirmation.approved",
    ]);
    expect(events.some((event) => event.type === "tool.failed")).toBe(true);
    expect(JSON.stringify(events)).not.toContain("Changed semantic target");
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-freshness-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy: "workspace",
    enabledTools: ["browser"],
  });
  const thread = await store.createThread({
    title: "Browser confirmation freshness",
    agentId: agent.id,
  });
  return {
    store,
    threadId: thread.id,
    registry: new ModelRegistry(),
  };
}

async function pendingConfirmation(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  confirmations: BrowserInteractionConfirmationManager,
) {
  let pending:
    | ReturnType<BrowserInteractionConfirmationManager["list"]>[number]
    | undefined;
  await vi.waitFor(
    () => {
      const runId = fixture.store.listRuns(fixture.threadId)[0]?.id;
      expect(runId).toBeDefined();
      pending = confirmations.list({
        threadId: fixture.threadId,
        runId: runId!,
      })[0];
      expect(pending?.action).toBe("click");
    },
    { timeout: 5_000 },
  );
  return pending!;
}

async function approve(
  fixture: Awaited<ReturnType<typeof createFixture>>,
  confirmations: BrowserInteractionConfirmationManager,
  pending: ReturnType<BrowserInteractionConfirmationManager["list"]>[number],
): Promise<void> {
  await confirmations.decide(
    {
      threadId: fixture.threadId,
      runId: fixture.store.listRuns(fixture.threadId)[0]!.id,
    },
    pending.id,
    {
      decision: "approve",
      expectedRequestSha256: pending.requestSha256,
    },
  );
}
