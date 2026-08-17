import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import {
  AgentRuntime,
  type BrowserSessionDetails,
  LocalStore,
  ModelRegistry,
  type RunBrowserSessionManager,
} from "../src/index.js";
import { BrowserInteractionConfirmationManager } from "../src/browser-interaction-confirmations.js";
import { withBrowserConfirmationState } from "./browser-confirmation-harness.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Agent Browser workspace preview", () => {
  it("interacts with ordinary offline controls without confirmation", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-preview-"));
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
      title: "Agent workspace preview",
      agentId: agent.id,
    });
    const registry = new ModelRegistry();
    const operations: string[] = [];
    const browserSessions = withBrowserConfirmationState({
      execute: vi.fn(
        async (
          _owner: { threadId: string; runId: string },
          request: { action: BrowserSessionDetails["action"] },
        ) => {
          operations.push(request.action);
          return {
            output: `PREVIEW_${request.action}`,
            details: details(request.action, operations.length),
          };
        },
      ),
      cancelRun: vi.fn(async () => undefined),
      hasActiveSession: vi.fn(() => true),
      hasWorkspacePreview: vi.fn(() =>
        operations.includes("preview_workspace"),
      ),
    }) as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-preview" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "preview_workspace",
          path: "site/index.html",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "click",
          target: { ref: "e1" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("browser", { action: "console" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Workspace preview verified."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    registry.registerProvider(provider.provider);
    const confirmations = new BrowserInteractionConfirmationManager(store, {
      available: true,
      timeoutMs: 5_000,
    });
    const runtime = new AgentRuntime(
      store,
      registry,
      undefined,
      undefined,
      undefined,
      undefined,
      browserSessions,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      confirmations,
    );

    const run = await runtime.runPrompt({
      threadId: thread.id,
      text: "Preview the local artifact and test its ordinary control.",
      model: { provider: "faux-browser-preview", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(operations).toEqual(["preview_workspace", "click", "console"]);
    expect(
      (await store.listEvents(thread.id)).some((event) =>
        event.type.startsWith("browser.interaction_confirmation."),
      ),
    ).toBe(false);
    store.close();
  });
});

function details(
  action: BrowserSessionDetails["action"],
  operation: number,
): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 3,
    action,
    sessionMode: "run_persistent",
    sessionReused: operation > 1,
    sessionOperation: operation,
    sessionIdSha256: "a".repeat(64),
    activeTabId: "tab_1",
    tabCount: 1,
    tabSetSha256: "b".repeat(64),
    browserExecutableSha256: "c".repeat(64),
    browserVersionSha256: "d".repeat(64),
    limitsSha256: "e".repeat(64),
    currentUrlSha256: "f".repeat(64),
    currentOriginSha256: "1".repeat(64),
    titleSha256: "2".repeat(64),
    pageDiagnosis: {
      status: "none",
      signalCount: 0,
      signalsSha256: "3".repeat(64),
      takeoverRecommended: false,
    },
    blockedRequestCount: 0,
    network: {
      requestCount: 0,
      connectCount: 0,
      rejectedCount: 0,
      transferredBytes: 0,
      destinationCount: 0,
      destinationsSha256: "4".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}
