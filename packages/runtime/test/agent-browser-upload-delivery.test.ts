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
import type { BrowserPreparedUpload } from "../src/browser-workspace-files.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { withBrowserConfirmationState } from "./browser-confirmation-harness.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("Agent Browser upload delivery", () => {
  it("uploads only the exact bytes inspected before one-use confirmation", async () => {
    const fixture = await createFixture();
    const inputPath = "artifacts/payload.json";
    const approvedBytes = Buffer.from('{"approved":true}\n');
    const changedBytes = Buffer.from('{"approved":false}\n');
    await writeFile(path.join(fixture.workspaceRoot, inputPath), approvedBytes);
    const operations: string[] = [];
    let executedUpload: BrowserPreparedUpload | undefined;
    const browserSessions = withBrowserConfirmationState({
      execute: vi.fn(
        async (
          _owner: { threadId: string; runId: string },
          request: { action: BrowserSessionDetails["action"] },
        ) => {
          operations.push(request.action);
          return {
            output: `BROWSER_${request.action}`,
            details: details(request.action, operations.length),
          };
        },
      ),
      executePreparedUpload: vi.fn(
        async (
          _owner: { threadId: string; runId: string },
          request: {
            action: "upload";
            target: { ref?: string };
            path: string;
          },
          upload: BrowserPreparedUpload,
        ) => {
          operations.push(request.action);
          expect(request).toEqual({
            action: "upload",
            target: { ref: "e7" },
            path: inputPath,
          });
          executedUpload = {
            ...upload,
            buffer: Buffer.from(upload.buffer),
          };
          return {
            output: [
              "Browser UPLOAD complete.",
              `File SHA-256: ${upload.fileSha256}`,
              `File bytes: ${String(upload.fileBytes)}`,
            ].join("\n"),
            details: {
              ...details(request.action, operations.length),
              file: {
                pathSha256: upload.pathSha256,
                fileSha256: upload.fileSha256,
                fileBytes: upload.fileBytes,
              },
            },
          };
        },
      ),
      cancelRun: vi.fn(async () => undefined),
      hasActiveSession: vi.fn(() => true),
    }) as unknown as RunBrowserSessionManager;
    const provider = fauxProvider({ provider: "faux-browser-upload" });
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
          action: "upload",
          target: { ref: "e7" },
          path: inputPath,
        }),
        { stopReason: "toolUse" },
      ),
      fauxAssistantMessage("Agent upload delivery completed."),
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
      text: "Upload the exact declared workspace payload.",
      model: { provider: "faux-browser-upload", id: "faux-1" },
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
      expect(pending).toEqual(
        expect.objectContaining({
          action: "upload",
          preview: expect.objectContaining({
            pathSha256: sha256(inputPath),
            fileSha256: sha256(approvedBytes),
            fileBytes: approvedBytes.byteLength,
          }),
        }),
      );
    });
    await writeFile(path.join(fixture.workspaceRoot, inputPath), changedBytes);
    await confirmations.decide(
      {
        threadId: fixture.threadId,
        runId: fixture.store.listRuns(fixture.threadId)[0]!.id,
      },
      pending!.id,
      {
        decision: "approve",
        expectedRequestSha256: pending!.requestSha256,
      },
    );

    const run = await running;

    expect(run.status, run.error).toBe("completed");
    expect(operations).toEqual(["start", "upload"]);
    expect(executedUpload).toEqual(
      expect.objectContaining({
        path: inputPath,
        pathSha256: sha256(inputPath),
        fileSha256: sha256(approvedBytes),
        fileBytes: approvedBytes.byteLength,
        name: "payload.json",
        mimeType: "application/json",
      }),
    );
    expect(executedUpload?.buffer).toEqual(approvedBytes);
    await expect(
      readFile(path.join(fixture.workspaceRoot, inputPath)),
    ).resolves.toEqual(changedBytes);
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
    const durable = JSON.stringify(
      events.filter(
        (event) =>
          event.type.startsWith("browser.interaction_confirmation.") ||
          event.type.startsWith("tool."),
      ),
    );
    expect(durable).not.toContain(inputPath);
    expect(durable).not.toContain(approvedBytes.toString("utf8").trim());
    expect(durable).not.toContain(changedBytes.toString("utf8").trim());
  });
});

async function createFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "napier-agent-upload-"));
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
    title: "Agent upload delivery",
    agentId: agent.id,
  });
  return {
    store,
    workspaceRoot,
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
