import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
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
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { withBrowserConfirmationState } from "./browser-confirmation-harness.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { force: true, recursive: true })),
  );
});

describe("Agent Browser screenshot delivery", () => {
  it("confirms and registers exact screenshot bytes in the same Run", async () => {
    const fixture = await createFixture();
    const screenshot = Buffer.from("EXACT_AGENT_SCREENSHOT");
    const screenshotSha256 = sha256(screenshot);
    const outputPath = "artifacts/agent-page.png";
    const operations: string[] = [];
    const browserSessions = withBrowserConfirmationState({
      execute: vi.fn(
        async (
          _owner: { threadId: string; runId: string },
          request: {
            action: BrowserSessionDetails["action"];
            path?: string;
            expectedLiveImageSha256?: string;
          },
        ) => {
          operations.push(request.action);
          if (request.action === "save_screenshot") {
            expect(request).toEqual({
              action: "save_screenshot",
              path: outputPath,
              expectedLiveImageSha256: screenshotSha256,
            });
            await writeFile(
              path.join(fixture.workspaceRoot, outputPath),
              screenshot,
            );
            return {
              output: "Browser SAVE_SCREENSHOT complete.",
              details: {
                ...details(request.action, operations.length),
                file: {
                  pathSha256: sha256(outputPath),
                  fileSha256: screenshotSha256,
                  fileBytes: screenshot.byteLength,
                },
              },
            };
          }
          return {
            output:
              request.action === "screenshot"
                ? `Browser SCREENSHOT captured.\nScreenshot SHA-256: ${screenshotSha256}`
                : `BROWSER_${request.action}`,
            details: {
              ...details(request.action, operations.length),
              ...(request.action === "screenshot"
                ? {
                    screenshotSha256,
                    screenshotBytes: screenshot.byteLength,
                  }
                : {}),
            },
            ...(request.action === "screenshot"
              ? {
                  screenshot: {
                    data: screenshot.toString("base64"),
                    mimeType: "image/png" as const,
                  },
                }
              : {}),
          };
        },
      ),
      cancelRun: vi.fn(async () => undefined),
      hasActiveSession: vi.fn(() => true),
    }) as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-screenshot-save" });
    provider.setResponses([
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "start",
          url: "https://example.com/",
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage(fauxToolCall("browser", { action: "screenshot" }), {
        stopReason: "toolUse",
      }),
      fauxAssistantMessage(
        fauxToolCall("browser", {
          action: "save_screenshot",
          path: outputPath,
          expectedLiveImageSha256: screenshotSha256,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Agent screenshot delivery completed."),
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
      text: "Capture and save the declared Browser screenshot.",
      model: { provider: "faux-browser-screenshot-save", id: "faux-1" },
      onRunCreated: async (run) => {
        let plan = await fixture.store.createPlan(fixture.threadId, {
          objective: "Deliver one Browser screenshot.",
          steps: [
            {
              id: "capture",
              title: "Capture Browser screenshot",
              description: "Save the exact screenshot bytes.",
              verification: "The declared PNG Artifact is verified.",
            },
          ],
          artifacts: [
            {
              id: "agent-screenshot",
              path: outputPath,
              kind: "file",
              description: "The exact Agent Browser screenshot.",
            },
          ],
        });
        plan = await fixture.store.transitionPlanStep(plan.id, "capture", {
          action: "start",
          runId: run.id,
        });
        expect(plan.steps[0]?.status).toBe("running");
      },
    });
    await vi.waitFor(() => {
      const run = fixture.store.listRuns(fixture.threadId)[0];
      expect({
        runStatus: run?.status,
        operations,
        confirmations: run
          ? confirmations.list({
              threadId: fixture.threadId,
              runId: run.id,
            })
          : [],
      }).toEqual({
        runStatus: "running",
        operations: ["start", "screenshot"],
        confirmations: [expect.objectContaining({ action: "save_screenshot" })],
      });
    });
    await approveNextConfirmation(
      confirmations,
      fixture.store,
      fixture.threadId,
    );

    const run = await running;

    expect(run.status, run.error).toBe("completed");
    expect(operations).toEqual(["start", "screenshot", "save_screenshot"]);
    await expect(
      readFile(path.join(fixture.workspaceRoot, outputPath)),
    ).resolves.toEqual(screenshot);
    expect(fixture.store.listPlans(fixture.threadId)[0]!.artifacts[0]).toEqual(
      expect.objectContaining({
        id: "agent-screenshot",
        status: "verified",
        sourceRunId: run.id,
        sha256: screenshotSha256,
        sizeBytes: screenshot.byteLength,
      }),
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
      events
        .filter((event) => event.type.startsWith("plan.artifact."))
        .map((event) => event.type),
    ).toEqual(["plan.artifact.produced", "plan.artifact.verified"]);
    expect(
      JSON.stringify(
        events.filter(
          (event) =>
            event.type.startsWith("browser.interaction_confirmation.") ||
            event.type.startsWith("tool."),
        ),
      ),
    ).not.toContain(outputPath);
  });

  it("confirms and registers exact downloaded bytes in the same Run", async () => {
    const fixture = await createFixture();
    const archive = Buffer.from("PK\u0003\u0004EXACT_AGENT_DOWNLOAD");
    const archiveSha256 = sha256(archive);
    const outputPath = "artifacts/archive.zip";
    const operations: string[] = [];
    const browserSessions = withBrowserConfirmationState({
      execute: vi.fn(
        async (
          _owner: { threadId: string; runId: string },
          request: {
            action: BrowserSessionDetails["action"];
            target?: { ref?: string };
            path?: string;
          },
        ) => {
          operations.push(request.action);
          if (request.action === "download") {
            expect(request).toEqual({
              action: "download",
              target: { ref: "e7" },
              path: outputPath,
            });
            await writeFile(
              path.join(fixture.workspaceRoot, outputPath),
              archive,
            );
            return {
              output: "Browser DOWNLOAD complete.",
              details: {
                ...details(request.action, operations.length),
                file: {
                  pathSha256: sha256(outputPath),
                  fileSha256: archiveSha256,
                  fileBytes: archive.byteLength,
                },
                suggestedFilenameSha256: sha256("archive.zip"),
              },
            };
          }
          return {
            output:
              request.action === "start"
                ? 'Browser START complete.\nlink "ZIP archive" [ref=e7]'
                : `BROWSER_${request.action}`,
            details: details(request.action, operations.length),
          };
        },
      ),
      cancelRun: vi.fn(async () => undefined),
      hasActiveSession: vi.fn(() => true),
    }) as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-download" });
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
          action: "download",
          target: { ref: "e7" },
          path: outputPath,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Agent download delivery completed."),
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
      text: "Download and verify the declared Browser archive.",
      model: { provider: "faux-browser-download", id: "faux-1" },
      onRunCreated: async (run) => {
        let plan = await fixture.store.createPlan(fixture.threadId, {
          objective: "Deliver one Browser download.",
          steps: [
            {
              id: "download",
              title: "Download Browser archive",
              description: "Save the exact downloaded bytes.",
              verification: "The declared ZIP Artifact is verified.",
            },
          ],
          artifacts: [
            {
              id: "archive",
              path: outputPath,
              kind: "file",
              description: "The exact Browser download.",
            },
          ],
        });
        plan = await fixture.store.transitionPlanStep(plan.id, "download", {
          action: "start",
          runId: run.id,
        });
        expect(plan.steps[0]?.status).toBe("running");
      },
    });
    await approveNextConfirmation(
      confirmations,
      fixture.store,
      fixture.threadId,
      "download",
    );

    const run = await running;

    expect(run.status, run.error).toBe("completed");
    expect(operations).toEqual(["start", "download"]);
    await expect(
      readFile(path.join(fixture.workspaceRoot, outputPath)),
    ).resolves.toEqual(archive);
    expect(fixture.store.listPlans(fixture.threadId)[0]!.artifacts[0]).toEqual(
      expect.objectContaining({
        id: "archive",
        status: "verified",
        sourceRunId: run.id,
        sha256: archiveSha256,
        sizeBytes: archive.byteLength,
      }),
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
      events
        .filter((event) => event.type.startsWith("plan.artifact."))
        .map((event) => event.type),
    ).toEqual(["plan.artifact.produced", "plan.artifact.verified"]);
    expect(
      JSON.stringify(
        events.filter(
          (event) =>
            event.type.startsWith("browser.interaction_confirmation.") ||
            event.type.startsWith("tool."),
        ),
      ),
    ).not.toContain(outputPath);
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-screenshot-"));
  roots.push(root);
  const workspaceRoot = path.join(root, "workspace");
  await mkdir(workspaceRoot);
  await mkdir(path.join(workspaceRoot, "artifacts"));
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
    title: "Agent screenshot delivery",
    agentId: agent.id,
  });
  return {
    store,
    workspaceRoot,
    threadId: thread.id,
    registry: new ModelRegistry(),
  };
}

async function approveNextConfirmation(
  confirmations: BrowserInteractionConfirmationManager,
  store: LocalStore,
  threadId: string,
  action: "save_screenshot" | "download" = "save_screenshot",
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
    tabSetSha256: sha256(canonicalJson(["tab_1"])),
    browserExecutableSha256: "b".repeat(64),
    browserVersionSha256: "c".repeat(64),
    limitsSha256: "d".repeat(64),
    currentUrlSha256: "e".repeat(64),
    currentOriginSha256: "f".repeat(64),
    titleSha256: "1".repeat(64),
    pageDiagnosis: {
      status: "none",
      signalCount: 0,
      signalsSha256: sha256(canonicalJson([])),
      takeoverRecommended: false,
    },
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
