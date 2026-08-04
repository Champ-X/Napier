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
  RunBrowserSessionManager,
} from "../src/index.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Agent Browser Session integration", () => {
  it("runs one persistent browser, projects private values, and cleans up the Run", async () => {
    const fixture = await createFixture("unrestricted");
    const operations: string[] = [];
    let operation = 0;
    const execute = vi.fn(
      async (
        _owner: { threadId: string; runId: string },
        request: { action: BrowserSessionDetails["action"] },
      ) => {
        operation += 1;
        operations.push(request.action);
        return {
          output: `PAGE_SECRET_${request.action}`,
          details: details(request.action, operation),
          ...(request.action === "screenshot"
            ? {
                screenshot: {
                  data: Buffer.from("SCREENSHOT_SECRET").toString("base64"),
                  mimeType: "image/png" as const,
                },
              }
            : {}),
        };
      },
    );
    const cancelRun = vi.fn(async () => undefined);
    const browserSessions = {
      execute,
      cancelRun,
    } as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "start",
          url: "https://example.com/?token=URL_SECRET",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("browser", { action: "snapshot" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "type",
          target: { selector: "#SELECTOR_SECRET" },
          text: "FORM_SECRET",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("browser", { action: "screenshot" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(fauxToolCall("browser", { action: "close" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        "The browser task completed and the Session closed.",
      ),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
      undefined,
      undefined,
      undefined,
      undefined,
      browserSessions,
    );

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Complete the browser task.",
      model: { provider: "faux-browser", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(operations).toEqual([
      "start",
      "snapshot",
      "type",
      "screenshot",
      "close",
    ]);
    expect(cancelRun).toHaveBeenCalledWith({
      threadId: fixture.threadId,
      runId: run.id,
    });
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events
        .filter(
          (event) =>
            event.type === "tool.started" &&
            record(event.payload)?.["toolName"] === "browser",
        )
        .map((event) => record(event.payload)?.["effect"]),
    ).toEqual(["read", "read", "write", "read", "read"]);
    const completed = events.filter(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "browser",
    );
    expect(completed).toHaveLength(5);
    expect(completed[1]?.payload).toEqual(
      expect.objectContaining({
        outputRedacted: true,
        details: expect.objectContaining({
          kind: "napier.browser-session-operation",
          action: "snapshot",
          sessionMode: "run_persistent",
          sessionReused: true,
          sessionOperation: 2,
        }),
      }),
    );
    const durable = JSON.stringify(events);
    for (const secret of [
      "URL_SECRET",
      "SELECTOR_SECRET",
      "FORM_SECRET",
      "PAGE_SECRET",
      Buffer.from("SCREENSHOT_SECRET").toString("base64"),
    ]) {
      expect(durable).not.toContain(secret);
    }
  });

  it("runs read-only Browser navigation under workspace policy", async () => {
    const fixture = await createFixture("workspace");
    const execute = vi.fn(async () => ({
      output: "PAGE_READ_ONLY",
      details: details("start", 1),
    }));
    const browserSessions = {
      execute,
      cancelRun: vi.fn(async () => undefined),
    } as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-blocked" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "start",
          url: "https://example.com/",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Browser read completed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
      undefined,
      undefined,
      undefined,
      undefined,
      browserSessions,
    );

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Try the browser.",
      model: { provider: "faux-browser-blocked", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(execute).toHaveBeenCalledTimes(1);
    expect(
      (await fixture.store.listEvents(fixture.threadId)).find(
        (event) =>
          event.type === "tool.completed" &&
          record(event.payload)?.["toolName"] === "browser",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        outputRedacted: true,
      }),
    );
  });

  it("does not expose interactive Browser actions under observe policy", async () => {
    const fixture = await createFixture("observe");
    const browserSessions = {
      execute: vi.fn(),
      cancelRun: vi.fn(async () => undefined),
    } as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({
      provider: "faux-browser-read-only-schema",
    });
    let browserActions: string[] = [];
    provider.setResponses([
      (context) => {
        const parameters = context.tools?.find(
          (tool) => tool.name === "browser",
        )?.parameters as
          | { anyOf?: Array<{ properties?: { action?: { const?: string } } }> }
          | undefined;
        browserActions = (parameters?.anyOf ?? []).flatMap((branch) =>
          typeof branch.properties?.action?.const === "string"
            ? [branch.properties.action.const]
            : [],
        );
        return fauxAssistantMessage(
          "No interactive Browser action was available.",
        );
      },
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
      undefined,
      undefined,
      undefined,
      undefined,
      browserSessions,
    );

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Inspect the available Browser tools.",
      model: { provider: "faux-browser-read-only-schema", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(browserSessions.execute).not.toHaveBeenCalled();
    expect(browserActions).toEqual([
      "start",
      "navigate",
      "back",
      "wait",
      "snapshot",
      "screenshot",
      "close",
    ]);
    for (const action of ["click", "type", "select", "upload", "download"]) {
      expect(browserActions).not.toContain(action);
    }
  });

  it("rejects a forged interactive Browser call before execution in observe mode", async () => {
    const fixture = await createFixture("observe");
    const browserSessions = {
      execute: vi.fn(),
      cancelRun: vi.fn(async () => undefined),
    } as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-forged-click" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "click",
          target: { ref: "e1" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The interactive action was blocked."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
      undefined,
      undefined,
      undefined,
      undefined,
      browserSessions,
    );

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Attempt a forged interactive Browser action.",
      model: { provider: "faux-browser-forged-click", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(browserSessions.execute).not.toHaveBeenCalled();
    const browserEvents = (
      await fixture.store.listEvents(fixture.threadId)
    ).filter(
      (event) =>
        event.type.startsWith("tool.") &&
        record(event.payload)?.["toolName"] === "browser",
    );
    expect(
      browserEvents.find((event) => event.type === "tool.started")?.payload,
    ).toEqual(expect.objectContaining({ action: "click", effect: "write" }));
    expect(browserEvents.some((event) => event.type === "tool.completed")).toBe(
      false,
    );
  });
});

async function createFixture(
  toolPolicy: "observe" | "workspace" | "unrestricted",
) {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-browser-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  const store = new LocalStore({
    workspaceRoot,
    dataRoot: path.join(root, "data"),
  });
  await store.initialize();
  const agent = await store.updateAgent(store.listAgents()[0]!.id, {
    toolPolicy,
    enabledTools: ["browser"],
  });
  const thread = await store.createThread({
    title: "Agent browser",
    agentId: agent.id,
  });
  return {
    store,
    threadId: thread.id,
    registry: new ModelRegistry(),
  };
}

function details(
  action: BrowserSessionDetails["action"],
  operation: number,
): BrowserSessionDetails {
  return {
    kind: "napier.browser-session-operation",
    schemaVersion: 1,
    action,
    sessionMode: "run_persistent",
    sessionReused: operation > 1,
    sessionOperation: operation,
    sessionIdSha256: "a".repeat(64),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    ...(action === "screenshot"
      ? {
          screenshotSha256: "2".repeat(64),
          screenshotBytes: 17,
        }
      : {}),
    blockedRequestCount: 0,
    network: {
      requestCount: operation,
      connectCount: 1,
      rejectedCount: 0,
      transferredBytes: 100,
      destinationCount: 1,
      destinationsSha256: "3".repeat(64),
    },
    crossOriginAuthorized: false,
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
