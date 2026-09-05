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
import { BrowserInteractionConfirmationManager } from "../src/browser-interaction-confirmations.js";
import { BrowserSessionPauseManager } from "../src/browser-session-pause.js";
import { browserOperationDetails } from "./agent-browser-test-support.js";
import { withBrowserConfirmationState } from "./browser-confirmation-harness.js";

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
          details: browserOperationDetails(request.action, operation),
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
    const browserSessions = withBrowserConfirmationState({
      execute,
      cancelRun,
    }) as unknown as RunBrowserSessionManager;
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
      browserSessions,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      confirmations,
    );

    const running = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Complete the browser task.",
      model: { provider: "faux-browser", id: "faux-1" },
    });
    await approveNextConfirmation(
      confirmations,
      fixture.store,
      fixture.threadId,
      "type",
    );
    const run = await running;

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
    expect(
      completed.map(
        (event) => record(record(event.payload)?.["details"])?.["action"],
      ),
    ).toEqual(["start", "snapshot", "type", "screenshot", "close"]);
    expect(events.map((event) => event.type)).toContain(
      "context.tool_result_unavailable",
    );
    expect(
      events.filter(
        (event) =>
          event.type === "tool.failed" &&
          record(event.payload)?.["toolName"] === "browser",
      ),
    ).toHaveLength(0);
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
    let operation = 0;
    const execute = vi.fn(
      async (
        _owner: { threadId: string; runId: string },
        request: { action: BrowserSessionDetails["action"] },
      ) => {
        operation += 1;
        return {
          output: "PAGE_READ_ONLY",
          details: browserOperationDetails(request.action, operation),
        };
      },
    );
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
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "find",
          query: "PRIVATE_FIND_QUERY",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "scroll",
          direction: "down",
          pixels: 720,
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
    expect(execute).toHaveBeenCalledTimes(3);
    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      {
        action: "start",
        url: "https://example.com/",
      },
      {
        action: "find",
        query: "PRIVATE_FIND_QUERY",
      },
      {
        action: "scroll",
        direction: "down",
        pixels: 720,
      },
    ]);
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(
      events.find(
        (event) =>
          event.type === "tool.completed" &&
          record(event.payload)?.["toolName"] === "browser",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        outputRedacted: true,
      }),
    );
    expect(JSON.stringify(events)).not.toContain("PRIVATE_FIND_QUERY");
    expect(
      events
        .filter(
          (event) =>
            event.type === "tool.started" &&
            record(event.payload)?.["toolName"] === "browser",
        )
        .map((event) => record(event.payload)?.["effect"]),
    ).toEqual(["read", "read", "read"]);
  });

  it("executes one confirmed Browser interaction in the same Run Session", async () => {
    const fixture = await createFixture("workspace");
    const operations: string[] = [];
    const browserSessions = withBrowserConfirmationState({
      execute: vi.fn(
        async (
          _owner: { threadId: string; runId: string },
          request: { action: BrowserSessionDetails["action"] },
        ) => {
          operations.push(request.action);
          return {
            output: `CONFIRMED_${request.action}`,
            details: browserOperationDetails(request.action, operations.length),
          };
        },
      ),
      cancelRun: vi.fn(async () => undefined),
      hasActiveSession: vi.fn(() => true),
    }) as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-confirmed" });
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
          target: { ref: "e1" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Confirmed Browser click completed."),
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
      browserSessions,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      confirmations,
    );
    const running = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Start the Browser and click the confirmed target.",
      model: { provider: "faux-browser-confirmed", id: "faux-1" },
    });
    let pending:
      | ReturnType<BrowserInteractionConfirmationManager["list"]>[number]
      | undefined;
    await vi.waitFor(() => {
      const run = fixture.store.listRuns(fixture.threadId)[0];
      expect(run).toBeDefined();
      pending = confirmations.list({
        threadId: fixture.threadId,
        runId: run!.id,
      })[0];
      expect(pending?.action).toBe("click");
    });
    const runId = fixture.store.listRuns(fixture.threadId)[0]!.id;
    await confirmations.decide(
      { threadId: fixture.threadId, runId },
      pending!.id,
      {
        decision: "approve",
        expectedRequestSha256: pending!.requestSha256,
      },
    );

    const run = await running;

    expect(run.status, run.error).toBe("completed");
    expect(operations).toEqual(["start", "click"]);
    expect(browserSessions.execute).toHaveBeenNthCalledWith(
      2,
      { threadId: fixture.threadId, runId: run.id },
      { action: "click", target: { ref: "e1" } },
      expect.any(AbortSignal),
    );
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
    ]);
    expect(
      events.some(
        (event) =>
          event.type === "tool.completed" &&
          record(event.payload)?.["toolName"] === "browser" &&
          record(record(event.payload)?.["details"])?.["action"] === "click",
      ),
    ).toBe(true);
  });

  it("pauses after the current Browser action and resumes the next in the same Run Session", async () => {
    const fixture = await createFixture("workspace");
    let releaseStart!: () => void;
    const startGate = new Promise<void>((resolve) => {
      releaseStart = resolve;
    });
    const operations: string[] = [];
    let operation = 0;
    const browserSessions = {
      execute: vi.fn(
        async (
          _owner: { threadId: string; runId: string },
          request: { action: BrowserSessionDetails["action"] },
        ) => {
          operation += 1;
          operations.push(request.action);
          if (request.action === "start") await startGate;
          return {
            output: `PAGE_${request.action}`,
            details: browserOperationDetails(request.action, operation),
          };
        },
      ),
      cancelRun: vi.fn(async () => undefined),
      hasActiveSession: vi.fn(() => true),
    } as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-pause" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "start",
          url: "https://example.com/",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("browser", { action: "snapshot" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage("Browser pause and resume completed."),
      fauxAssistantMessage('{"facts":[]}'),
    ]);
    fixture.registry.registerProvider(provider.provider);
    const pauses = new BrowserSessionPauseManager(fixture.store);
    const runtime = new AgentRuntime(
      fixture.store,
      fixture.registry,
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
      undefined,
      pauses,
    );
    const running = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Start the Browser, then take a snapshot.",
      model: { provider: "faux-browser-pause", id: "faux-1" },
    });
    await vi.waitFor(() => expect(operations).toEqual(["start"]));
    const runId = fixture.store.listRuns(fixture.threadId)[0]!.id;
    const owner = { threadId: fixture.threadId, runId };
    const paused = await pauses.pause(owner);

    releaseStart();
    await vi.waitFor(async () => {
      const events = await fixture.store.listEvents(fixture.threadId);
      expect(
        events.some(
          (event) =>
            event.type === "tool.completed" &&
            record(event.payload)?.["toolName"] === "browser" &&
            record(record(event.payload)?.["details"])?.["action"] === "start",
        ),
      ).toBe(true);
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(operations).toEqual(["start"]);
    expect(fixture.store.listRuns(fixture.threadId)[0]?.status).toBe("running");

    await pauses.resume(owner, paused.contentSha256);
    const run = await running;

    expect(run.status, run.error).toBe("completed");
    expect(run.id).toBe(runId);
    expect(operations).toEqual(["start", "snapshot"]);
    expect(browserSessions.execute).toHaveBeenNthCalledWith(
      2,
      owner,
      { action: "snapshot" },
      expect.any(AbortSignal),
    );
    const events = await fixture.store.listEvents(fixture.threadId);
    const requested = events.find(
      (event) => event.type === "browser.session_pause.requested",
    );
    const startCompleted = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "browser" &&
        record(record(event.payload)?.["details"])?.["action"] === "start",
    );
    const resumed = events.find(
      (event) => event.type === "browser.session_pause.resumed",
    );
    const snapshotCompleted = events.find(
      (event) =>
        event.type === "tool.completed" &&
        record(event.payload)?.["toolName"] === "browser" &&
        record(record(event.payload)?.["details"])?.["action"] === "snapshot",
    );
    expect(requested?.seq).toBeLessThan(startCompleted!.seq);
    expect(startCompleted?.seq).toBeLessThan(resumed!.seq);
    expect(resumed?.seq).toBeLessThan(snapshotCompleted!.seq);
  });

  it("does not execute a rejected Browser interaction", async () => {
    const fixture = await createFixture("workspace");
    const browserSessions = withBrowserConfirmationState({
      execute: vi.fn(async () => ({
        output: "STARTED",
        details: browserOperationDetails("start", 1),
      })),
      cancelRun: vi.fn(async () => undefined),
    }) as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-rejected" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "click",
          target: { selector: "#PRIVATE_REJECTED_SELECTOR" },
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("The rejected interaction was not executed."),
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
      browserSessions,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      confirmations,
    );
    const running = runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Attempt the Browser click only if confirmed.",
      model: { provider: "faux-browser-rejected", id: "faux-1" },
    });
    let pending:
      | ReturnType<BrowserInteractionConfirmationManager["list"]>[number]
      | undefined;
    await vi.waitFor(() => {
      const runId = fixture.store.listRuns(fixture.threadId)[0]?.id;
      expect(runId).toBeDefined();
      pending = confirmations.list({
        threadId: fixture.threadId,
        runId: runId!,
      })[0];
      expect(pending?.action).toBe("click");
    });
    const runId = fixture.store.listRuns(fixture.threadId)[0]!.id;
    await confirmations.decide(
      { threadId: fixture.threadId, runId },
      pending!.id,
      {
        decision: "reject",
        expectedRequestSha256: pending!.requestSha256,
      },
    );

    const run = await running;

    expect(run.status, run.error).toBe("completed");
    expect(browserSessions.execute).not.toHaveBeenCalled();
    const events = await fixture.store.listEvents(fixture.threadId);
    expect(JSON.stringify(events)).not.toContain("PRIVATE_REJECTED_SELECTOR");
    expect(
      events.find(
        (event) => event.type === "browser.interaction_confirmation.rejected",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        action: "click",
        status: "rejected",
      }),
    );
    expect(
      events.find(
        (event) =>
          event.type === "tool.blocked" &&
          record(event.payload)?.["toolName"] === "browser",
      )?.payload,
    ).toEqual(
      expect.objectContaining({
        inputRedacted: true,
        policyReason: expect.stringContaining("was not confirmed"),
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
      "preview_workspace",
      "navigate",
      "back",
      "forward",
      "tab_new",
      "tab_list",
      "tab_switch",
      "tab_close",
      "wait",
      "find",
      "scroll",
      "snapshot",
      "screenshot",
      "console",
      "close",
    ]);
    for (const action of ["click", "type", "select", "upload", "download"]) {
      expect(browserActions).not.toContain(action);
    }
  });

  it("does not expose interactive Browser actions without a confirmation channel", async () => {
    const fixture = await createFixture("workspace");
    const browserSessions = {
      execute: vi.fn(),
      cancelRun: vi.fn(async () => undefined),
    } as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({
      provider: "faux-browser-no-confirmation-channel",
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
          "No confirmation-bound Browser action was available.",
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
      text: "Inspect Browser actions without a confirmation channel.",
      model: {
        provider: "faux-browser-no-confirmation-channel",
        id: "faux-1",
      },
    });

    expect(run.status, run.error).toBe("completed");
    expect(browserActions).toEqual([
      "start",
      "preview_workspace",
      "navigate",
      "back",
      "forward",
      "tab_new",
      "tab_list",
      "tab_switch",
      "tab_close",
      "wait",
      "find",
      "scroll",
      "snapshot",
      "screenshot",
      "console",
      "close",
    ]);
    expect(browserSessions.execute).not.toHaveBeenCalled();
  });

  it("does not expose interactive Browser actions to non-user Runs", async () => {
    const fixture = await createFixture("workspace");
    const browserSessions = {
      execute: vi.fn(),
      cancelRun: vi.fn(async () => undefined),
    } as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({
      provider: "faux-browser-schedule-read-only",
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
          "Scheduled Browser access stayed read-only.",
        );
      },
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
      browserSessions,
      undefined,
      undefined,
      undefined,
      undefined,
      {},
      confirmations,
    );

    const run = await runtime.runPrompt({
      threadId: fixture.threadId,
      text: "Inspect scheduled Browser authority.",
      source: "schedule",
      model: { provider: "faux-browser-schedule-read-only", id: "faux-1" },
    });

    expect(run.status, run.error).toBe("completed");
    expect(browserActions).toEqual([
      "start",
      "preview_workspace",
      "navigate",
      "back",
      "forward",
      "tab_new",
      "tab_list",
      "tab_switch",
      "tab_close",
      "wait",
      "find",
      "scroll",
      "snapshot",
      "screenshot",
      "console",
      "close",
    ]);
    expect(browserSessions.execute).not.toHaveBeenCalled();
    expect(
      (await fixture.store.listEvents(fixture.threadId)).some((event) =>
        event.type.startsWith("browser.interaction_confirmation."),
      ),
    ).toBe(false);
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
    expect(browserEvents.some((event) => event.type === "tool.started")).toBe(
      false,
    );
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

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}

async function approveNextConfirmation(
  confirmations: BrowserInteractionConfirmationManager,
  store: LocalStore,
  threadId: string,
  action: ReturnType<
    BrowserInteractionConfirmationManager["list"]
  >[number]["action"],
): Promise<void> {
  let pending:
    | ReturnType<BrowserInteractionConfirmationManager["list"]>[number]
    | undefined;
  await vi.waitFor(() => {
    const runId = store.listRuns(threadId)[0]?.id;
    expect(runId).toBeDefined();
    pending = confirmations.list({ threadId, runId: runId! })[0];
    expect(pending?.action).toBe(action);
  });
  await confirmations.decide(
    { threadId, runId: store.listRuns(threadId)[0]!.id },
    pending!.id,
    {
      decision: "approve",
      expectedRequestSha256: pending!.requestSha256,
    },
  );
}
