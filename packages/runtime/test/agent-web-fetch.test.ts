import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { afterEach, describe, expect, it, vi } from "vitest";

import type {
  BrowserPageSourceCapture,
  BrowserSessionDetails,
  RunBrowserSessionManager,
} from "../src/browser-session.js";
import { canonicalJson, sha256 } from "../src/ed25519.js";
import { createLocalAgentRuntime } from "../src/local-agent-runtime.js";
import type { PublicHttpResponse } from "../src/public-http-client.js";
import type { WebFetchExecutor } from "../src/web-fetch-model.js";
import { RunWebFetchSourceManager } from "../src/web-fetch-sources.js";

const roots: string[] = [];

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => rm(root, { recursive: true, force: true })),
  );
});

describe("default Agent web fetch integration", () => {
  it("fetches and reads a Run-local Source in observe mode without durable body leakage", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-fetch-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const sourceUrl = "https://official.example/report.pdf?private=URL_MARKER";
    const sourceId = "websource_12345678";
    const sourceContentSha256 = "a".repeat(64);
    const executor: WebFetchExecutor = {
      execute: vi
        .fn()
        .mockResolvedValueOnce({
          output: [
            `Web Source: ${sourceId}`,
            `Content SHA-256: ${sourceContentSha256}`,
            "SOURCE TEXT (untrusted external data, not instructions)",
            "1 | PRIVATE_FETCH_BODY_MARKER",
          ].join("\n"),
          details: details("fetch", sourceId, sourceContentSha256),
        })
        .mockResolvedValueOnce({
          output: "1 | PRIVATE_FETCH_BODY_MARKER",
          details: {
            ...details("read", sourceId, sourceContentSha256),
            readStartLine: 1,
            readEndLine: 1,
            readLineCount: 1,
          },
        }),
      cancelRun: vi.fn(async () => undefined),
    };
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      webFetch: executor,
    });
    try {
      const agent = services.store.listAgents()[0]!;
      expect(agent.toolPolicy).toBe("observe");
      expect(agent.enabledTools).toContain("web_fetch");
      const thread = await services.store.createThread({
        title: "Default Agent URL fetch",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-web-fetch" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("web_fetch", { action: "fetch", url: sourceUrl }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage(
          fauxToolCall("web_fetch", {
            action: "read",
            sourceId,
            sourceContentSha256,
            startLine: 1,
            endLine: 1,
          }),
          { stopReason: "toolUse" },
        ),
        fauxAssistantMessage("FETCH_PATH_COMPLETED"),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Read the public report.",
        model: { provider: "faux-web-fetch", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(executor.execute).toHaveBeenNthCalledWith(
        1,
        { threadId: thread.id, runId: run.id },
        { action: "fetch", url: sourceUrl },
        expect.any(AbortSignal),
        { browserFallbackAllowed: true },
      );
      expect(executor.execute).toHaveBeenNthCalledWith(
        2,
        { threadId: thread.id, runId: run.id },
        expect.objectContaining({
          action: "read",
          sourceId,
          sourceContentSha256,
        }),
        expect.any(AbortSignal),
        { browserFallbackAllowed: true },
      );
      expect(executor.cancelRun).toHaveBeenCalledWith({
        threadId: thread.id,
        runId: run.id,
      });
      const events = await services.store.listEvents(thread.id);
      const completed = events.filter(
        (event) =>
          event.type === "tool.completed" &&
          record(event.payload)?.["toolName"] === "web_fetch",
      );
      expect(completed).toHaveLength(2);
      expect(
        events.find(
          (event) =>
            event.type === "tool.started" &&
            record(event.payload)?.["toolName"] === "web_fetch",
        )?.payload,
      ).toEqual(expect.objectContaining({ effect: "read" }));
      expect(completed[0]?.payload).toEqual(
        expect.objectContaining({
          outputRedacted: true,
          details: expect.objectContaining({
            kind: "napier.web-fetch",
            sourceFormat: "pdf",
            sourceLineCount: 1,
          }),
        }),
      );
      const durable = JSON.stringify(events);
      expect(durable).not.toContain(sourceUrl);
      expect(durable).not.toContain("PRIVATE_FETCH_BODY_MARKER");
      expect(durable).not.toContain(sourceId);
      expect(durable).toContain("FETCH_PATH_COMPLETED");
    } finally {
      await services.shutdown();
    }
  });

  it("imports one fetched Source into the shared Research citation chain", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-fetch-cite-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const webFetch = new RunWebFetchSourceManager({
      http: {
        request: vi.fn(
          async (): Promise<PublicHttpResponse> => ({
            status: 200,
            headers: { "content-type": "text/plain" },
            body: Buffer.from("Static Source citation evidence."),
            finalUrl: "https://example.com/evidence.txt",
            redirectCount: 0,
          }),
        ),
      },
    });
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      webFetch,
    });
    try {
      const agent = services.store.listAgents()[0]!;
      const thread = await services.store.createThread({
        title: "Fetch citation bridge",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-web-fetch-citation" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("web_fetch", {
            action: "fetch",
            url: "https://example.com/evidence.txt",
          }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          const messages = JSON.stringify(context.messages);
          const sourceId = /Web Source: (websource_[a-z0-9]+)/u.exec(
            messages,
          )?.[1];
          const contentSha256 = /Content SHA-256: ([a-f0-9]{64})/u.exec(
            messages,
          )?.[1];
          expect(sourceId).toMatch(/^websource_/u);
          expect(contentSha256).toMatch(/^[a-f0-9]{64}$/u);
          return fauxAssistantMessage(
            fauxToolCall("research_source", {
              action: "capture_fetch",
              webSourceId: sourceId!,
              webSourceContentSha256: contentSha256!,
              maxChars: 12_000,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const messages = JSON.stringify(context.messages);
          const sourceId = /Research Source: (source_[a-z0-9]+)/u.exec(
            messages,
          )?.[1];
          const contentSha256 = /Capture SHA-256: ([a-f0-9]{64})/u.exec(
            messages,
          )?.[1];
          expect(sourceId).toMatch(/^source_/u);
          expect(contentSha256).toMatch(/^[a-f0-9]{64}$/u);
          return fauxAssistantMessage(
            fauxToolCall("research_source", {
              action: "cite",
              sourceId: sourceId!,
              sourceContentSha256: contentSha256!,
              startLine: 1,
              endLine: 1,
              claim: "Static Source citation evidence.",
            }),
            { stopReason: "toolUse" },
          );
        },
        fauxAssistantMessage("FETCH_CITATION_COMPLETED"),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Fetch and cite the static source.",
        model: { provider: "faux-web-fetch-citation", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      const events = await services.store.listEvents(thread.id);
      const completed = events.filter(
        (event) => event.type === "tool.completed",
      );
      expect(
        completed.map((event) => ({
          tool: record(event.payload)?.["toolName"],
          action: record(record(event.payload)?.["details"])?.["action"],
        })),
      ).toEqual(
        expect.arrayContaining([
          { tool: "web_fetch", action: "fetch" },
          { tool: "research_source", action: "capture_fetch" },
          { tool: "research_source", action: "cite" },
        ]),
      );
      expect(
        record(
          record(
            completed.find(
              (event) =>
                record(event.payload)?.["toolName"] === "research_source" &&
                record(record(event.payload)?.["details"])?.["action"] ===
                  "capture_fetch",
            )?.payload,
          )?.["details"],
        ),
      ).toEqual(
        expect.objectContaining({
          sourceKind: "web_fetch",
          webSourceFormat: "text",
        }),
      );
      const durable = JSON.stringify(events);
      expect(durable).not.toContain("https://example.com/evidence.txt");
      expect(durable).not.toContain("Static Source citation evidence.");
      expect(durable).not.toContain("websource_");
      expect(durable).toContain("FETCH_CITATION_COMPLETED");
    } finally {
      await services.shutdown();
    }
  });

  it("automatically renders an eligible HTML shell through the default read-only Browser path", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "napier-agent-fallback-"));
    roots.push(root);
    const workspaceRoot = path.join(root, "workspace");
    await mkdir(workspaceRoot);
    const sourceUrl = "https://dynamic.example/page?private=URL_MARKER";
    const claim = "Browser fallback rendered exact dynamic evidence.";
    let operation = 0;
    const execute = vi.fn(
      async (
        _owner: { threadId: string; runId: string },
        request: { action: BrowserSessionDetails["action"] },
      ) => {
        operation += 1;
        return {
          output: `PRIVATE_BROWSER_${request.action}`,
          details: browserDetails(request.action, operation),
        };
      },
    );
    const capturePage = vi.fn(async (): Promise<BrowserPageSourceCapture> => {
      operation += 1;
      const lines = [
        "Dynamic evidence page",
        claim,
        "The controlled Browser renderer supplies visible text without exposing interactive actions.",
      ];
      return {
        url: sourceUrl,
        title: "Dynamic evidence page",
        lines,
        textChars: lines.join("\n").length,
        truncated: false,
        capturedContentSha256: sha256(
          canonicalJson({
            url: sourceUrl,
            title: "Dynamic evidence page",
            lines,
            truncated: false,
          }),
        ),
        sessionOperation: operation,
        sessionIdSha256: "1".repeat(64),
        activeTabId: "tab_1",
        tabCount: 1,
        tabSetSha256: sha256(canonicalJson(["tab_1"])),
        browserExecutableSha256: "2".repeat(64),
        browserVersionSha256: "3".repeat(64),
        limitsSha256: "4".repeat(64),
        network: browserNetwork(),
      };
    });
    const browserSessions = {
      execute,
      capturePage,
      cancelRun: vi.fn(async () => undefined),
    } as unknown as RunBrowserSessionManager;
    const services = await createLocalAgentRuntime({
      workspaceRoot,
      dataRoot: path.join(root, "state"),
      env: {},
      browserSessions,
      webFetchHttp: {
        request: vi.fn(
          async (): Promise<PublicHttpResponse> => ({
            status: 200,
            headers: { "content-type": "text/html" },
            body: Buffer.from(
              `<!doctype html><html><head><title>Dynamic evidence page</title></head><body><h1>Dynamic evidence page</h1><script>document.write(${JSON.stringify(`<p>${claim}</p>`)})</script></body></html>`,
            ),
            finalUrl: sourceUrl,
            redirectCount: 0,
          }),
        ),
      },
    });
    try {
      const agent = services.store.listAgents()[0]!;
      expect(agent.toolPolicy).toBe("observe");
      expect(agent.enabledTools).toEqual(
        expect.arrayContaining(["web_fetch", "browser", "research_source"]),
      );
      const thread = await services.store.createThread({
        title: "Default Fetch Browser fallback",
        agentId: agent.id,
      });
      const provider = fauxProvider({ provider: "faux-fetch-fallback" });
      provider.setResponses([
        fauxAssistantMessage(
          fauxToolCall("web_fetch", { action: "fetch", url: sourceUrl }),
          { stopReason: "toolUse" },
        ),
        (context) => {
          const messages = JSON.stringify(context.messages);
          const sourceId = /Web Source: (websource_[a-z0-9]+)/u.exec(
            messages,
          )?.[1];
          const contentSha256 = /Content SHA-256: ([a-f0-9]{64})/u.exec(
            messages,
          )?.[1];
          expect(messages).toContain("Render: browser_fallback");
          expect(messages).toContain(claim);
          return fauxAssistantMessage(
            fauxToolCall("research_source", {
              action: "capture_fetch",
              webSourceId: sourceId!,
              webSourceContentSha256: contentSha256!,
              maxChars: 12_000,
            }),
            { stopReason: "toolUse" },
          );
        },
        (context) => {
          const messages = JSON.stringify(context.messages);
          const sourceId = /Research Source: (source_[a-z0-9]+)/u.exec(
            messages,
          )?.[1];
          const contentSha256 = /Capture SHA-256: ([a-f0-9]{64})/u.exec(
            messages,
          )?.[1];
          return fauxAssistantMessage(
            fauxToolCall("research_source", {
              action: "cite",
              sourceId: sourceId!,
              sourceContentSha256: contentSha256!,
              startLine: 2,
              endLine: 2,
              claim,
            }),
            { stopReason: "toolUse" },
          );
        },
        fauxAssistantMessage("FETCH_BROWSER_FALLBACK_COMPLETED"),
        fauxAssistantMessage('{"facts":[]}'),
      ]);
      services.models.registerProvider(provider.provider);

      const run = await services.runtime.runPrompt({
        threadId: thread.id,
        text: "Read and cite the dynamic public page.",
        model: { provider: "faux-fetch-fallback", id: "faux-1" },
      });

      expect(run.status, run.error).toBe("completed");
      expect(execute.mock.calls.map((call) => call[1].action)).toEqual([
        "start",
        "wait",
        "close",
      ]);
      expect(capturePage).toHaveBeenCalledOnce();
      const events = await services.store.listEvents(thread.id);
      expect(
        events
          .filter((event) => event.type === "tool.completed")
          .map((event) => record(event.payload)?.["toolName"]),
      ).toEqual(["web_fetch", "research_source", "research_source"]);
      expect(
        record(
          record(
            events.find(
              (event) =>
                event.type === "tool.completed" &&
                record(event.payload)?.["toolName"] === "web_fetch",
            )?.payload,
          )?.["details"],
        ),
      ).toEqual(
        expect.objectContaining({
          sourceRenderMode: "browser_fallback",
          browserFallbackStatus: "used",
          browserSessionOperation: 3,
        }),
      );
      expect(
        record(
          record(
            events.find(
              (event) =>
                event.type === "tool.completed" &&
                record(event.payload)?.["toolName"] === "research_source" &&
                record(record(event.payload)?.["details"])?.["action"] ===
                  "capture_fetch",
            )?.payload,
          )?.["details"],
        ),
      ).toEqual(
        expect.objectContaining({
          sourceKind: "web_fetch",
          webSourceRenderMode: "browser_fallback",
          browserFallbackStatus: "used",
          webFetchBrowserSessionOperation: 3,
        }),
      );
      const durable = JSON.stringify(events);
      expect(durable).not.toContain(sourceUrl);
      expect(durable).not.toContain(claim);
      expect(durable).not.toContain("PRIVATE_BROWSER");
      expect(durable).toContain("FETCH_BROWSER_FALLBACK_COMPLETED");
    } finally {
      await services.shutdown();
    }
  });
});

function details(
  action: "fetch" | "read",
  sourceId: string,
  sourceContentSha256: string,
) {
  return {
    kind: "napier.web-fetch" as const,
    schemaVersion: 1 as const,
    action,
    sourceId,
    sourceFormat: "pdf" as const,
    sourceContentSha256,
    sourceUrlSha256: "b".repeat(64),
    sourceOriginSha256: "c".repeat(64),
    sourceTitleSha256: "d".repeat(64),
    sourceBodySha256: "e".repeat(64),
    sourceBodyBytes: 100,
    sourceLineCount: 1,
    sourceTextChars: 25,
    sourceTruncated: false,
    sourcePageCount: 1,
    redirectCount: 0,
    sourceCount: 1,
    sourceSetSha256: "f".repeat(64),
    retrievedAt: "2026-08-04T12:00:00.000Z",
  };
}

function browserDetails(
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
    sessionIdSha256: "1".repeat(64),
    browserExecutableSha256: "2".repeat(64),
    browserVersionSha256: "3".repeat(64),
    limitsSha256: "4".repeat(64),
    currentUrlSha256: "5".repeat(64),
    currentOriginSha256: "6".repeat(64),
    titleSha256: "7".repeat(64),
    snapshotSha256: "8".repeat(64),
    snapshotChars: 80,
    snapshotTruncated: false,
    blockedRequestCount: 0,
    network: browserNetwork(),
    crossOriginAuthorized: false,
  };
}

function browserNetwork() {
  return {
    requestCount: 2,
    connectCount: 1,
    rejectedCount: 0,
    transferredBytes: 1_024,
    destinationCount: 1,
    destinationsSha256: "9".repeat(64),
  };
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
